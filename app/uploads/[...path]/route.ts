import path from 'path';
import { promises as fs } from 'fs';

import { NextResponse } from 'next/server';

import { logServerError } from '@/src/server/errorLogger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_req: Request, context: { params: { path: string[] } }) {
  const segments = Array.isArray(context.params?.path) ? context.params.path : [];
  const baseDir = path.join(process.cwd(), 'public', 'uploads');
  const targetPath = path.join(baseDir, ...segments);
  const normalizedBase = path.normalize(baseDir);
  const normalizedTarget = path.normalize(targetPath);

  if (!normalizedTarget.startsWith(normalizedBase)) {
    return NextResponse.json({ message: 'Not Found' }, { status: 404 });
  }

  try {
    const stat = await fs.stat(normalizedTarget);
    if (stat.isDirectory()) {
      return NextResponse.json({ message: 'Not Found' }, { status: 404 });
    }

    const fileBuffer = await fs.readFile(normalizedTarget);
    const contentType = getMimeType(normalizedTarget);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ message: 'Not Found' }, { status: 404 });
    }

    await logServerError({ appName: 'uploads', message: '파일 서빙 실패', error });
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.heic':
      return 'image/heic';
    case '.heif':
      return 'image/heif';
    case '.avif':
      return 'image/avif';
    default:
      return 'application/octet-stream';
  }
}
