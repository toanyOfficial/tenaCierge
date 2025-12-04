const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.78;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지 로딩에 실패했습니다.'));
    img.src = url;
  });
}

function toJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('이미지 인코딩에 실패했습니다.'));
        }
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  });
}

export async function resizeImageFile(file: File): Promise<File> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(objectUrl);
    const maxSide = Math.max(image.width, image.height);
    const scale = maxSide > MAX_DIMENSION ? MAX_DIMENSION / maxSide : 1;

    const targetWidth = Math.max(1, Math.round(image.width * scale));
    const targetHeight = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
    const blob = await toJpegBlob(canvas);

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch (err) {
    console.error('이미지 리사이즈 중 오류 발생, 원본 업로드로 대체합니다.', err);
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
