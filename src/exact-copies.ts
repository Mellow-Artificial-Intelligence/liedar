/**
 * Finds regions that duplicate another region of the same page pixel for
 * pixel. Sensor and paper noise mean a real scan never repeats itself exactly,
 * so in a lossless image an exact copy was pasted in.
 */
import {
  evidenceShift,
  forEachRepeatGroup,
  GrowableArray,
  largestConnectedPatch,
  regionFromPatch,
  type CopiedRegion,
  type GrayImage,
} from "./copy-regions.ts";

const BLOCK = 8;
/** A block must contain an edge, not just paper or the inside of a stroke. */
const MIN_BLOCK_RANGE = 48;
/** A block must have gray pixels, which carry noise, not just black and white. */
const MIN_GRAY_PIXELS = 8;
/** Blocks one shift must match to count as a copied region. Genuine scans rarely reach 20. */
const MIN_MATCHING_BLOCKS = 20;
/** Blocks that repeat more often than this are a pattern, such as a ruled line, not a paste. */
const MAX_REPEATS = 20;

const ROW_BASE = 0x01000193;
const COLUMN_BASE = 0x9e3779b1;

export function findExactCopies(gray: GrayImage) {
  const { hashes, positions } = texturedBlocks(gray);
  const sourcesByShift = new Map<number, number[]>();
  const repeatingShare = forEachRepeatGroup(hashes, positions, MAX_REPEATS, (group) => {
    for (let first = 0; first < group.length; first++) {
      for (let second = first + 1; second < group.length; second++) {
        const pair = evidenceShift(gray.width, group[first]!, group[second]!);
        if (pair && sameBlock(gray, group[first]!, group[second]!)) {
          (sourcesByShift.get(pair.shift) ?? sourcesByShift.set(pair.shift, []).get(pair.shift)!).push(pair.source);
        }
      }
    }
  });

  const regions: CopiedRegion[] = [...sourcesByShift.entries()]
    .filter(([, sources]) => sources.length >= MIN_MATCHING_BLOCKS)
    .map(([shift, sources]) => regionFromPatch(gray, "exact", shift, largestConnectedPatch(sources, gray.width), BLOCK))
    .filter((region) => region.matchingBlocks >= MIN_MATCHING_BLOCKS);
  return { regions, repeatingShare, texturedBlocks: hashes.length };
}

/** Each textured block's position and a hash of its pixels, from a rolling hash over every position. */
function texturedBlocks({ pixels, width, height }: GrayImage) {
  // Row hashes for the current row and the BLOCK rows above it, reused as the window slides down.
  const rowHashes = new Int32Array(width * (BLOCK + 1));
  const columnHashes = new Int32Array(width);
  const shiftOut = power(COLUMN_BASE, BLOCK);
  const hashes = new GrowableArray();
  const positions = new GrowableArray();

  for (let y = 0; y < height; y++) {
    const current = (y % (BLOCK + 1)) * width;
    const leaving = ((y + 1) % (BLOCK + 1)) * width;
    hashRow(pixels, y * width, width, rowHashes, current);
    for (let x = 0; x <= width - BLOCK; x++) {
      let hash = Math.imul(columnHashes[x]!, COLUMN_BASE) + rowHashes[current + x]!;
      if (y >= BLOCK) {
        hash -= Math.imul(rowHashes[leaving + x]!, shiftOut);
      }
      columnHashes[x] = hash | 0;
    }
    const top = y - BLOCK + 1;
    if (top < 0) {
      continue;
    }
    for (let x = 0; x <= width - BLOCK; x++) {
      if (isTextured(pixels, width, x, top)) {
        hashes.push(columnHashes[x]! >>> 0);
        positions.push(top * width + x);
      }
    }
  }
  return { hashes: hashes.values(), positions: positions.values() };
}

/** Writes, for each position in a row, a hash of the BLOCK pixels starting there. */
function hashRow(pixels: Uint8Array, rowStart: number, width: number, target: Int32Array, offset: number) {
  const shiftOut = power(ROW_BASE, BLOCK);
  let hash = 0;
  for (let x = 0; x < width; x++) {
    hash = (Math.imul(hash, ROW_BASE) + pixels[rowStart + x]! + 1) | 0;
    if (x >= BLOCK) {
      hash = (hash - Math.imul(pixels[rowStart + x - BLOCK]! + 1, shiftOut)) | 0;
    }
    if (x >= BLOCK - 1) {
      target[offset + x - BLOCK + 1] = hash;
    }
  }
}

function isTextured(pixels: Uint8Array, width: number, left: number, top: number) {
  let darkest = 255;
  let lightest = 0;
  let grayPixels = 0;
  for (let y = top; y < top + BLOCK; y++) {
    for (let x = left; x < left + BLOCK; x++) {
      const value = pixels[y * width + x]!;
      darkest = Math.min(darkest, value);
      lightest = Math.max(lightest, value);
      if (value > 8 && value < 247) {
        grayPixels++;
      }
    }
  }
  return lightest - darkest >= MIN_BLOCK_RANGE && grayPixels >= MIN_GRAY_PIXELS;
}

/** Confirms a hash match pixel by pixel, so a collision can't report a copy. */
function sameBlock({ pixels, width }: GrayImage, first: number, second: number) {
  for (let y = 0; y < BLOCK; y++) {
    for (let x = 0; x < BLOCK; x++) {
      if (pixels[first + y * width + x] !== pixels[second + y * width + x]) {
        return false;
      }
    }
  }
  return true;
}

function power(base: number, exponent: number) {
  let result = 1;
  for (let step = 0; step < exponent; step++) {
    result = Math.imul(result, base);
  }
  return result;
}
