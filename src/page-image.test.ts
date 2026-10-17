import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { MAX_SIDE_PIXELS, MIN_SIDE_PIXELS, toPageImage } from "./page-image";

async function solidImage(width: number, height: number, options: { orientation?: number } = {}) {
  const image = sharp({ create: { width, height, channels: 3, background: "gray" } }).jpeg();
  return new Uint8Array(await (options.orientation ? image.withMetadata(options) : image).toBuffer());
}

async function sizeOf(data: Uint8Array) {
  const { width, height } = await sharp(data).metadata();
  return [width, height];
}

describe("toPageImage", () => {
  test("shrinks a large photo to the maximum side, keeping its aspect ratio", async () => {
    const page = await toPageImage(await solidImage(4032, 3024), "jpeg");
    expect(page.mediaType).toBe("image/jpeg");
    expect(await sizeOf(page.data)).toEqual([MAX_SIDE_PIXELS, 1176]);
  });

  test("pads a small image up to the minimum side", async () => {
    const page = await toPageImage(await solidImage(120, 90), "png");
    expect(page.mediaType).toBe("image/png");
    expect(await sizeOf(page.data)).toEqual([MIN_SIDE_PIXELS, MIN_SIDE_PIXELS]);
  });

  test("pads the short side of a long receipt strip", async () => {
    const page = await toPageImage(await solidImage(400, 4000), "jpeg");
    expect(await sizeOf(page.data)).toEqual([MIN_SIDE_PIXELS, MAX_SIDE_PIXELS]);
  });

  test("rotates the pixels to match the EXIF orientation", async () => {
    // Orientation 6 means the camera was turned sideways: stored landscape, displayed portrait.
    const page = await toPageImage(await solidImage(800, 600, { orientation: 6 }), "jpeg");
    expect(await sizeOf(page.data)).toEqual([600, 800]);
  });
});
