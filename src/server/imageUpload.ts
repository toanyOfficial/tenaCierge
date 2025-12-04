import { createWriteStream } from 'fs';
import { mkdir, unlink } from 'fs/promises';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

import sharp from 'sharp';

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
    const fileStream = Readable.fromWeb(file.stream());
    const limiter = createSizeLimiter(maxFileSizeBytes);
    const resizeTransform = sharp()
      .rotate()
      .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: jpegQuality, mozjpeg: true });

    try {
      await pipeline(fileStream, limiter, resizeTransform, createWriteStream(destPath));
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
