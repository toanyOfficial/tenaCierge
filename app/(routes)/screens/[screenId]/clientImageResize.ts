const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.78;
const GRID_SIZE = 5;
const CENTER_SCALE = 0.5; // 50% downscale for the 3x3 center
const EDGE_SCALE = 0.2; // 80% downscale for the 2x2 border

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

    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = targetWidth;
    baseCanvas.height = targetHeight;
    const baseCtx = baseCanvas.getContext('2d');
    if (!baseCtx) return file;
    baseCtx.drawImage(image, 0, 0, targetWidth, targetHeight);

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = targetWidth;
    outputCanvas.height = targetHeight;
    const outputCtx = outputCanvas.getContext('2d');
    if (!outputCtx) return file;

    const tileWidth = Math.ceil(targetWidth / GRID_SIZE);
    const tileHeight = Math.ceil(targetHeight / GRID_SIZE);

    for (let row = 0; row < GRID_SIZE; row += 1) {
      for (let col = 0; col < GRID_SIZE; col += 1) {
        const left = col * tileWidth;
        const top = row * tileHeight;
        if (left >= targetWidth || top >= targetHeight) continue;

        const currentTileWidth = Math.min(tileWidth, targetWidth - left);
        const currentTileHeight = Math.min(tileHeight, targetHeight - top);
        const scaleFactor = row >= 1 && row <= 3 && col >= 1 && col <= 3 ? CENTER_SCALE : EDGE_SCALE;

        const downWidth = Math.max(1, Math.round(currentTileWidth * scaleFactor));
        const downHeight = Math.max(1, Math.round(currentTileHeight * scaleFactor));

        const downCanvas = document.createElement('canvas');
        downCanvas.width = downWidth;
        downCanvas.height = downHeight;
        const downCtx = downCanvas.getContext('2d');
        if (!downCtx) continue;
        downCtx.imageSmoothingEnabled = true;
        downCtx.drawImage(baseCanvas, left, top, currentTileWidth, currentTileHeight, 0, 0, downWidth, downHeight);

        const upCanvas = document.createElement('canvas');
        upCanvas.width = currentTileWidth;
        upCanvas.height = currentTileHeight;
        const upCtx = upCanvas.getContext('2d');
        if (!upCtx) continue;
        upCtx.imageSmoothingEnabled = false; // nearest-neighbor like upscale
        upCtx.drawImage(downCanvas, 0, 0, currentTileWidth, currentTileHeight);

        outputCtx.drawImage(upCanvas, left, top, currentTileWidth, currentTileHeight);
      }
    }

    const blob = await toJpegBlob(outputCanvas);
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch (err) {
    console.error('이미지 리사이즈 중 오류 발생, 원본 업로드로 대체합니다.', err);
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
