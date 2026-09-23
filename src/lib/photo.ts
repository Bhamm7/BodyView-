/**
 * Photos are stored inline with the record they belong to, as a data URL.
 *
 * That keeps them inside the same sync and backup as everything else — one
 * SQLite file still holds the whole app — at the cost of needing them small.
 * A phone camera's 4MB JPEG would be miserable to sync and pointless at the
 * size it is displayed, so every image is redrawn to fit a box and
 * re-encoded before it is stored.
 */
const MAX_EDGE = 900;
const QUALITY = 0.72;

/** Roughly the biggest data URL worth keeping: about 400KB of base64. */
export const MAX_PHOTO_BYTES = 420_000;

export class PhotoTooLarge extends Error {
  constructor() {
    super('That image is too large to store even after shrinking.');
    this.name = 'PhotoTooLarge';
  }
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    // Honours EXIF orientation, which a bare <img> on older iOS does not.
    return createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Shrinks an image file to a JPEG data URL small enough to live in a record.
 * Quality steps down rather than failing outright, since a slightly softer
 * photo of a machine is still a useful reminder of which machine.
 */
export async function toStoredPhoto(file: Blob): Promise<string> {
  const source = await loadBitmap(file);
  const width = 'width' in source ? source.width : 0;
  const height = 'height' in source ? source.height : 0;
  const scale = Math.min(1, MAX_EDGE / Math.max(width || MAX_EDGE, height || MAX_EDGE));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((width || MAX_EDGE) * scale));
  canvas.height = Math.max(1, Math.round((height || MAX_EDGE) * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process images.');
  ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  if ('close' in source) source.close();

  for (const quality of [QUALITY, 0.6, 0.45, 0.3]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= MAX_PHOTO_BYTES) return url;
  }
  throw new PhotoTooLarge();
}
