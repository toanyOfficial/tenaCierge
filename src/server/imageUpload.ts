import { createWriteStream } from 'fs';
import { mkdir, unlink } from 'fs/promises';
import path from 'path';
import { Readable, Transform } from 'stream';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { pipeline } from 'stream/promises';

declare const __non_webpack_require__: NodeRequire;

export type UploadedImage = { slotId: number; url: string };

type ProcessImageOptions = {
  files: File[];
  slots: number[];
  baseDir: string;
  urlPrefix: string;
  maxFileSizeBytes?: number;
  maxTotalSizeBytes?: number;
  maxDimension?: number;
  jpegQuality?: number;
};

export class UploadError extends Error {
  constructor(
    public code: 'FILE_TOO_LARGE' | 'TOTAL_TOO_LARGE' | 'INVALID_SLOT' | 'UPLOAD_FAILED',
    message?: string
  ) {
    super(message ?? code);
    this.name = 'UploadError';
  }
}

// Many smartphone cameras produce 8~12MB JPEGs; allow some headroom so uploads
// are accepted before compression/resize kicks in.
const DEFAULT_MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
const DEFAULT_MAX_TOTAL_SIZE = 60 * 1024 * 1024; // 60MB per request
const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_JPEG_QUALITY = 78;

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function createSizeLimiter(limitBytes: number) {
  let total = 0;

  return new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length;
      if (total > limitBytes) {
        callback(new UploadError('FILE_TOO_LARGE', '업로드 가능한 파일 크기를 초과했습니다.'));
        return;
      }
      callback(null, chunk);
    }
  });
}

function loadSharpFactory(): (() => any) | null {
  const requireFn = typeof __non_webpack_require__ === 'function' ? __non_webpack_require__ : require;
  const specifier = ['sharp'].join('');

  try {
    const loaded = requireFn(specifier);
    return (loaded?.default ?? loaded) as () => any;
  } catch (error) {
    console.warn('sharp가 설치되어 있지 않아 이미지 리사이즈 없이 저장합니다.', error);
    return null;
  }
}

export async function processImageUploads({
  files,
  slots,
  baseDir,
  urlPrefix,
  maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE,
  maxTotalSizeBytes = DEFAULT_MAX_TOTAL_SIZE,
  maxDimension = DEFAULT_MAX_DIMENSION,
  jpegQuality = DEFAULT_JPEG_QUALITY
}: ProcessImageOptions): Promise<UploadedImage[]> {
  const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0);

  if (totalSize > maxTotalSizeBytes) {
    throw new UploadError('TOTAL_TOO_LARGE', '업로드 가능한 총 용량을 초과했습니다.');
  }

  if (files.length !== slots.length) {
    throw new UploadError('INVALID_SLOT', '이미지 매핑 정보가 올바르지 않습니다.');
  }

  await mkdir(baseDir, { recursive: true });
  const uploads: UploadedImage[] = [];
  const sharpFactory = loadSharpFactory();

  for (const [index, file] of files.entries()) {
    if (file.size && file.size > maxFileSizeBytes) {
      throw new UploadError('FILE_TOO_LARGE', '업로드 가능한 파일 크기를 초과했습니다.');
    }

    const slotId = slots[index];
    if (!Number.isFinite(slotId)) {
      throw new UploadError('INVALID_SLOT', '이미지 매핑 정보가 올바르지 않습니다.');
    }

    const safeName = sanitizeFilename(file.name || 'image');
    const baseName = safeName.replace(/\.[^.]+$/, '');
    const destName = `${Date.now()}-${index}-${baseName || 'image'}.jpg`;
    const destPath = path.join(baseDir, destName);

    const limiter = createSizeLimiter(maxFileSizeBytes);
    const fileStream = Readable.fromWeb(file.stream() as unknown as WebReadableStream);

    try {
      const chunks: Buffer[] = [];
      await pipeline(fileStream, limiter, new Transform({
        transform(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback(null, chunk);
        }
      }));

      const sourceBuffer = Buffer.concat(chunks);
      const processedBuffer = sharpFactory
        ? await applyRegionalDownscale(sharpFactory, sourceBuffer, { maxDimension, jpegQuality })
        : sourceBuffer;

      await pipeline(Readable.from(processedBuffer), createWriteStream(destPath));
    } catch (error) {
      await unlink(destPath).catch(() => {});
      if (error instanceof UploadError) {
        throw error;
      }
      throw new UploadError('UPLOAD_FAILED', error instanceof Error ? error.message : '업로드 실패');
    }

    uploads.push({ slotId, url: path.posix.join(urlPrefix, destName) });
  }

  return uploads;
}

type RegionalDownscaleOptions = {
  maxDimension: number;
  jpegQuality: number;
};

async function applyRegionalDownscale(sharpFactory: () => any, input: Buffer, options: RegionalDownscaleOptions) {
  const { maxDimension, jpegQuality } = options;
  const base = sharpFactory();
  const { data: resizedBuffer, info } = await base
    .rotate()
    .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: jpegQuality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const width = info.width ?? maxDimension;
  const height = info.height ?? maxDimension;
  const tileWidth = Math.ceil(width / 5);
  const tileHeight = Math.ceil(height / 5);

  const composites: { input: Buffer; left: number; top: number }[] = [];

  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const left = col * tileWidth;
      const top = row * tileHeight;
      if (left >= width || top >= height) {
        continue;
      }
      const currentTileWidth = Math.min(tileWidth, width - left);
      const currentTileHeight = Math.min(tileHeight, height - top);
      const scale = row >= 1 && row <= 3 && col >= 1 && col <= 3 ? 0.5 : 0.2;

      const tileBuffer = await sharpFactory()(resizedBuffer)
        .extract({ left, top, width: currentTileWidth, height: currentTileHeight })
        .resize({
          width: Math.max(1, Math.round(currentTileWidth * scale)),
          height: Math.max(1, Math.round(currentTileHeight * scale)),
          fit: 'inside'
        })
        .resize({ width: currentTileWidth, height: currentTileHeight, fit: 'fill', kernel: 'nearest' })
        .jpeg({ quality: jpegQuality, mozjpeg: true })
        .toBuffer();

      composites.push({ input: tileBuffer, left, top });
    }
  }

  const degraded = sharpFactory()({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  });

  return degraded.composite(composites).jpeg({ quality: jpegQuality, mozjpeg: true }).toBuffer();
}
