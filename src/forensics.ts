/**
 * Pixel forensics run before the model sees a page: finds regions of a scanned or
 * photographed page that copy another region of the same page, the commonest
 * way receipts and invoices are altered, and draws close-ups of them for the model.
 */
import sharp from "sharp";
import { POSITION_BITS, type Box, type CopiedRegion } from "./copy-regions.ts";
import { findExactCopies } from "./exact-copies.ts";
import { findNearCopies } from "./near-copies.ts";
import { toPageImage, type PageImage } from "./page-image.ts";

export type { Box, CopiedRegion } from "./copy-regions.ts";

/** With fewer textured blocks there's too little on the page to check. */
const MIN_TEXTURED_BLOCKS = 200;
/** Above this share of exactly repeating blocks, the image was generated digitally and repeats itself naturally. */
const MAX_REPEATING_SHARE = 0.25;
/**
 * Near matching also finds the repeated text of a screen capture saved as
 * JPEG, so it runs only on pages that barely repeat exactly. Real JPEG receipts
 * stay under 0.12; JPEG screenshots repeat more than 0.2.
 */
const MAX_REPEATING_SHARE_FOR_NEAR = 0.15;
const MAX_REPORTED_REGIONS = 3;

export type CopyCheck =
  | { checked: true; copiedRegions: CopiedRegion[]; note?: string }
  | { checked: false; reason: string };

/**
 * Looks for regions of the image that duplicate another region of it: exactly,
 * and for JPEGs also up to compression. A lossless image keeps a pasted copy
 * exact, so there a near match is the same character printed twice.
 */
export async function findCopiedRegions(image: Uint8Array): Promise<CopyCheck> {
  const { format } = await sharp(image).metadata();
  const { data, info } = await sharp(image)
    // Matches the orientation of the page image the model sees.
    .rotate()
    .flatten({ background: "#ffffff" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const gray = { pixels: new Uint8Array(data), width: info.width, height: info.height };
  if (gray.width * gray.height > POSITION_BITS) {
    return { checked: false, reason: "The image is too large to check." };
  }

  const exact = findExactCopies(gray);
  if (exact.texturedBlocks < MIN_TEXTURED_BLOCKS) {
    return { checked: false, reason: "The page has too little text or texture to check." };
  }
  if (exact.repeatingShare > MAX_REPEATING_SHARE) {
    return { checked: false, reason: "The image looks digitally generated, so identical text repeats naturally." };
  }
  if (format !== "jpeg") {
    return { checked: true, copiedRegions: strongest(exact.regions) };
  }
  if (exact.repeatingShare > MAX_REPEATING_SHARE_FOR_NEAR) {
    return {
      checked: true,
      copiedRegions: strongest(exact.regions),
      note: "The page repeats itself too much, as a screenshot does, to check for copies changed by JPEG compression.",
    };
  }

  const near = findNearCopies(gray);
  if ("skipped" in near) {
    return { checked: true, copiedRegions: strongest(exact.regions), note: near.skipped };
  }
  const newShifts = near.regions.filter((region) => !exact.regions.some((found) => sameShift(found, region)));
  return { checked: true, copiedRegions: strongest([...exact.regions, ...newShifts]) };
}

/** Exact copies first, since they're the stronger evidence, then the largest. */
function strongest(regions: CopiedRegion[]) {
  return regions
    .sort((a, b) => Number(b.match === "exact") - Number(a.match === "exact") || b.matchingBlocks - a.matchingBlocks)
    .slice(0, MAX_REPORTED_REGIONS);
}

function sameShift(a: CopiedRegion, b: CopiedRegion) {
  const shift = (region: CopiedRegion) => [region.copy.left - region.source.left, region.copy.top - region.source.top];
  const [ax, ay] = shift(a);
  const [bx, by] = shift(b);
  return Math.abs(ax! - bx!) < 0.01 && Math.abs(ay! - by!) < 0.01;
}

/** How big a close-up shows each side of a copied region, and how much page it shows around it. */
const CLOSE_UP_HEIGHT = 400;
const CLOSE_UP_MAX_WIDTH = 700;
const CLOSE_UP_GAP = 24;
const CLOSE_UP_MIN_MARGIN = 0.06;

/**
 * A close-up of a copied region: its source on the left and the copy on the
 * right, each outlined in red and enlarged with some of the page around it so
 * the model can see what the copy covers.
 */
export async function closeUp(image: Uint8Array, { source, copy }: CopiedRegion): Promise<PageImage> {
  const { data, info } = await sharp(image)
    .rotate()
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer({ resolveWithObject: true });
  const [left, right] = await Promise.all([source, copy].map((box) => outlinedCrop(data, info, box)));
  const sideBySide = await sharp({
    create: {
      width: left!.info.width + CLOSE_UP_GAP + right!.info.width,
      height: Math.max(left!.info.height, right!.info.height),
      channels: 3,
      background: "#808080",
    },
  })
    .composite([
      { input: left!.data, left: 0, top: 0 },
      { input: right!.data, left: left!.info.width + CLOSE_UP_GAP, top: 0 },
    ])
    .png()
    .toBuffer();
  return toPageImage(new Uint8Array(sideBySide), "png");
}

/** The box and the page around it, with the box outlined, enlarged to the close-up's height. */
async function outlinedCrop(page: Buffer, { width, height }: { width: number; height: number }, box: Box) {
  const marginX = Math.max(2 * box.width, CLOSE_UP_MIN_MARGIN);
  const marginY = Math.max(2 * box.height, CLOSE_UP_MIN_MARGIN);
  const left = Math.max(0, Math.floor((box.left - marginX) * width));
  const top = Math.max(0, Math.floor((box.top - marginY) * height));
  const right = Math.min(width, Math.ceil((box.left + box.width + marginX) * width));
  const bottom = Math.min(height, Math.ceil((box.top + box.height + marginY) * height));
  const outline = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${right - left}" height="${bottom - top}">` +
      `<rect x="${box.left * width - left}" y="${box.top * height - top}" width="${box.width * width}" height="${box.height * height}" fill="none" stroke="red" stroke-width="2"/></svg>`,
  );
  const outlined = await sharp(page)
    .extract({ left, top, width: right - left, height: bottom - top })
    .composite([{ input: outline }])
    .png()
    .toBuffer();
  return sharp(outlined)
    .resize({ height: CLOSE_UP_HEIGHT, width: CLOSE_UP_MAX_WIDTH, fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });
}
