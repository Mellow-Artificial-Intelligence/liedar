/**
 * Prepares page images for Jev, which rejects images outside its limits rather
 * than resizing them: https://docs.typesafe.ai/images#limits
 */
import sharp from "sharp";

export const MAX_SIDE_PIXELS = 1568;
export const MIN_SIDE_PIXELS = 280;

export type PageImage = { mediaType: "image/png" | "image/jpeg"; data: Uint8Array };

/**
 * Rotates the pixels upright, shrinks the image to fit within the maximum side
 * length, and pads any side shorter than the minimum with white.
 */
export async function toPageImage(input: Uint8Array, format: "png" | "jpeg"): Promise<PageImage> {
  const resized = await sharp(input)
    // Jev strips EXIF without applying its orientation, so bake it into the pixels.
    .rotate()
    .resize({ width: MAX_SIDE_PIXELS, height: MAX_SIDE_PIXELS, fit: "inside", withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });

  const padded = sharp(resized.data).extend({
    right: Math.max(0, MIN_SIDE_PIXELS - resized.info.width),
    bottom: Math.max(0, MIN_SIDE_PIXELS - resized.info.height),
    background: "white",
  });
  const data = format === "png" ? await padded.png().toBuffer() : await padded.jpeg({ quality: 90 }).toBuffer();

  return { mediaType: `image/${format}`, data: new Uint8Array(data) };
}
