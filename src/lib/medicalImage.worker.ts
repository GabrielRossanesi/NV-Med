import { medicalImagePolicy, medicalRasterInfo } from './medicalFile';

async function optimize(file: File, kind: 'jpg' | 'png') {
  const info = medicalRasterInfo(new Uint8Array(await file.arrayBuffer()), kind);
  if (!info || info.preserve || Math.max(info.width, info.height) > medicalImagePolicy.maxOptimizationSide
    || info.width * info.height > medicalImagePolicy.maxBrowserPixels) return null;

  const source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let result: ImageBitmap | undefined;
  try {
    const { width, height } = source;
    if (width * height !== info.width * info.height) return null;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(source, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: medicalImagePolicy.quality });
    if (blob.type !== 'image/webp' || blob.size >= file.size) return null;

    result = await createImageBitmap(blob);
    if (result.width !== width || result.height !== height) return null;
    const verification = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
    if (!verification) return null;
    verification.drawImage(result, 0, 0);
    // Check local changes so that small details are not averaged out across a full page.
    for (let row = 0; row < height; row += 64) {
      for (let column = 0; column < width; column += 64) {
        const tileWidth = Math.min(width - column, 64);
        const tileHeight = Math.min(height - row, 64);
        const before = context.getImageData(column, row, tileWidth, tileHeight).data;
        const after = verification.getImageData(column, row, tileWidth, tileHeight).data;
        let differences = 0;
        for (let i = 0; i < before.length; i += 4) {
          if (before[i + 3] !== after[i + 3]) return null;
          if (!before[i + 3]) continue;
          const luminanceChange = Math.abs((before[i] - after[i]) * 0.2126
            + (before[i + 1] - after[i + 1]) * 0.7152 + (before[i + 2] - after[i + 2]) * 0.0722);
          if (luminanceChange > 48) return null;
          if (luminanceChange > 18) differences++;
        }
        if (differences > tileWidth * tileHeight * 0.02) return null;
      }
    }
    return blob;
  } finally {
    source.close();
    result?.close();
  }
}

self.onmessage = async ({ data }: MessageEvent<{ file: File; kind: 'jpg' | 'png' }>) => {
  const result = await optimize(data.file, data.kind).catch(() => null);
  self.postMessage(result);
};
