export const MAX_IMAGE_UPLOAD_BYTES = 7_500_000;
export const MAX_IMAGE_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_COMPOSER_IMAGES = 4;

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function extensionFor(mimeType: string) {
  return mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "webp";
}

function optimizedFileName(name: string, mimeType: string) {
  const stem = name.replace(/\.[^.]+$/, "") || "image";
  return `${stem}-optimized.${extensionFor(mimeType)}`;
}

async function decodeImage(file: File): Promise<{ width: number; height: number; draw: (context: CanvasRenderingContext2D, width: number, height: number) => void; close?: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return { width: bitmap.width, height: bitmap.height, draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height), close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("image_decode_failed"));
      element.src = url;
    });
    return { width: image.naturalWidth, height: image.naturalHeight, draw: (context, width, height) => context.drawImage(image, 0, 0, width, height) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

/** Keeps normal files intact and optimizes only oversized supported images for the 8 MB server boundary. */
export async function optimizeImageForUpload(file: File): Promise<File> {
  if (!IMAGE_TYPES.has(file.type) || file.size <= MAX_IMAGE_UPLOAD_BYTES) return file;
  if (file.size > MAX_IMAGE_SOURCE_BYTES) throw new Error("Фотография слишком велика для обработки на устройстве. Выберите файл до 32 МБ.");
  if (typeof document === "undefined" || typeof document.createElement !== "function") throw new Error("Не удалось подготовить фотографию. Повторите попытку с более компактным файлом.");

  const decoded = await decodeImage(file);
  try {
    if (!decoded.width || !decoded.height) throw new Error("image_decode_failed");
    const preferredMime = file.type === "image/jpeg" ? "image/jpeg" : "image/webp";
    const longestSide = Math.max(decoded.width, decoded.height);
    let scale = Math.min(1, 2560 / longestSide);
    for (let pass = 0; pass < 6; pass += 1) {
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("image_canvas_failed");
      decoded.draw(context, width, height);
      for (const quality of [0.86, 0.76, 0.66]) {
        const blob = await toBlob(canvas, preferredMime, quality);
        if (blob && blob.size > 0 && blob.size <= MAX_IMAGE_UPLOAD_BYTES) {
          return new File([blob], optimizedFileName(file.name, preferredMime), { type: preferredMime, lastModified: file.lastModified });
        }
      }
      scale *= 0.72;
    }
    throw new Error("Не удалось уменьшить фотографию до поддерживаемого размера. Выберите менее детальное изображение.");
  } finally {
    decoded.close?.();
  }
}
