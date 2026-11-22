import { AVATAR_SIZE } from "@pm/shared";

/**
 * Center-crops an image file to a square and scales it to `AVATAR_SIZE` px,
 * so uploads stay small whatever the original photo was. Encodes as WebP,
 * or PNG in browsers that can't encode WebP.
 */
export async function prepareAvatar(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This file isn't an image the browser can open");
  }

  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(AVATAR_SIZE, side);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process the image");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (!blob) throw new Error("Couldn't process the image");
  return blob;
}

/** The blob's bytes as plain base64 (no `data:` prefix), for JSON request bodies. */
export function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Error("Couldn't read the image"));
    reader.readAsDataURL(blob);
  });
}
