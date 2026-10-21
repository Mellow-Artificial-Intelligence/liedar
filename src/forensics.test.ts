import { describe, expect, test } from "bun:test";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
import { findCopiedRegions } from "./forensics.ts";

const WIDTH = 400;
const HEIGHT = 600;

/** A gray page of noisy dark strokes, like a scanned receipt, so no two parts of it match exactly. */
function noisyScan() {
  let state = 7;
  const random = () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 4294967296;
  };
  const pixels = new Uint8Array(WIDTH * HEIGHT).map(() => 225 + Math.floor(random() * 20));
  for (let stroke = 0; stroke < 300; stroke++) {
    const left = Math.floor(random() * (WIDTH - 20));
    const top = Math.floor(random() * (HEIGHT - 20));
    const [width, height] = random() < 0.5 ? [3, 14] : [12, 3];
    for (let y = top; y < top + height; y++) {
      for (let x = left; x < left + width; x++) {
        pixels[y * WIDTH + x] = 40 + Math.floor(random() * 40);
      }
    }
  }
  return pixels;
}

function paste(pixels: Uint8Array, from: { x: number; y: number }, to: { x: number; y: number }, size: number) {
  const copy = pixels.slice();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      copy[(to.y + y) * WIDTH + to.x + x] = pixels[(from.y + y) * WIDTH + from.x + x]!;
    }
  }
  return copy;
}

async function png(pixels: Uint8Array) {
  return new Uint8Array(await sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 1 } }).png().toBuffer());
}

async function jpeg(pixels: Uint8Array) {
  return new Uint8Array(await sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 1 } }).jpeg({ quality: 85 }).toBuffer());
}

/** A page as a camera or scanner saves it: already a JPEG before anyone edits it. */
async function photographed(pixels: Uint8Array) {
  return new Uint8Array(await sharp(await jpeg(pixels)).greyscale().raw().toBuffer());
}

describe("findCopiedRegions", () => {
  test("finds a patch pasted from elsewhere on the page", async () => {
    const pasted = paste(noisyScan(), { x: 50, y: 60 }, { x: 213, y: 401 }, 40);
    const result = await findCopiedRegions(await png(pasted));

    expect(result.checked).toBe(true);
    if (!result.checked) return;
    const [region] = result.copiedRegions;
    expect(region?.match).toBe("exact");
    expect(region?.source.left).toBeCloseTo(50 / WIDTH, 1);
    expect(region?.source.top).toBeCloseTo(60 / HEIGHT, 1);
    expect(region?.copy.left).toBeCloseTo(213 / WIDTH, 1);
    expect(region?.copy.top).toBeCloseTo(401 / HEIGHT, 1);
    expect(region!.matchingBlocks).toBeGreaterThan(100);
  });

  test("finds nothing on a page that wasn't edited", async () => {
    expect(await findCopiedRegions(await png(noisyScan()))).toEqual({ checked: true, copiedRegions: [] });
  });

  test("finds a patch pasted into a photo and saved as JPEG again", async () => {
    const pasted = paste(await photographed(noisyScan()), { x: 50, y: 60 }, { x: 213, y: 401 }, 40);
    const result = await findCopiedRegions(await jpeg(pasted));

    expect(result.checked).toBe(true);
    if (!result.checked) return;
    const [region] = result.copiedRegions;
    expect(region?.match).toBe("near");
    expect(region?.source.left).toBeCloseTo(50 / WIDTH, 1);
    expect(region?.copy.top).toBeCloseTo(401 / HEIGHT, 1);
  });

  test("finds nothing in a photo that wasn't edited", async () => {
    expect(await findCopiedRegions(await jpeg(await photographed(noisyScan())))).toEqual({ checked: true, copiedRegions: [] });
  });

  test("reports no copies in a JPEG screenshot, whose text repeats nearly exactly", async () => {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const context = canvas.getContext("2d");
    context.fillStyle = "#eef3fb";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = "#1a2b4c";
    context.font = "18px sans-serif";
    for (let line = 0; line < 30; line++) {
      context.fillText(`Transfer ${(line * 37.13).toFixed(2)} Balance`, 12, 20 + line * 19);
    }
    const screenshot = new Uint8Array(await sharp(await canvas.encode("png")).jpeg({ quality: 85 }).toBuffer());

    const result = await findCopiedRegions(screenshot);

    expect(result.checked ? result.copiedRegions : []).toEqual([]);
  });

  test("doesn't check rendered text, whose characters repeat exactly", async () => {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = "#111111";
    context.font = "20px sans-serif";
    for (let line = 0; line < 20; line++) {
      context.fillText("Coffee 3.50  Total 12.68", 20, 30 + line * 28);
    }
    const result = await findCopiedRegions(new Uint8Array(await canvas.encode("png")));

    expect(result).toMatchObject({ checked: false, reason: expect.stringContaining("digitally generated") });
  });

  test("doesn't check a blank page", async () => {
    const blank = await png(new Uint8Array(WIDTH * HEIGHT).fill(250));
    expect(await findCopiedRegions(blank)).toMatchObject({ checked: false, reason: expect.stringContaining("too little") });
  });
});
