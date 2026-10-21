/**
 * Finds regions that duplicate another region of the same page up to JPEG
 * compression, which changes every pixel slightly so a pasted patch no longer
 * matches its source exactly.
 *
 * Candidates come from a coarse signature of each block that survives
 * compression: a pasted patch has hundreds of blocks, so enough of them keep
 * their signature to point at the shift. Each candidate shift is then checked
 * pixel by pixel, keeping only blocks whose copy differs from them by little
 * more than compression noise.
 */
import {
  evidenceShift,
  forEachRepeatGroup,
  GrowableArray,
  neighbors,
  regionFromPatch,
  type CopiedRegion,
  type GrayImage,
} from "./copy-regions.ts";

/** Blocks are 9×9 pixels, signed by the means of their nine 3×3 cells. */
const CELL = 3;
const BLOCK = 3 * CELL;
/** Cell means are rounded to this many gray levels for the signature. */
const SIGNATURE_STEP = 24;
/** A block's cell means must differ by this much, so it holds part of a character, not paper. */
const MIN_CELL_RANGE = 40;
/** Signatures shared by more blocks than this are a pattern, not a paste. */
const MAX_REPEATS = 20;
/** Shifts need this many blocks agreeing on them to be worth checking pixel by pixel. */
const MIN_VOTES = 3;
const MAX_CANDIDATE_SHIFTS = 30;
/**
 * A block matches its copy when their squared difference is at most this share
 * of the block's own variance: compression noise, not a second printing of
 * the same character.
 */
const MATCH_TOLERANCE = 0.006;
/** A block that matches itself within this many tolerances after a small nudge is an edge or a repeating pattern. */
const AMBIGUITY = 10;
const NUDGE = 3;
/** Matching blocks a patch needs to count as a copied region. */
const MIN_MATCHING_BLOCKS = 40;
/**
 * Pixels this close to pure black or white. Above the share, the scan was
 * thresholded to black and white, where every printing of a character is
 * identical, so near copies can't be told from reprints.
 */
const EXTREME_MARGIN = 8;
const MAX_EXTREME_SHARE = 0.9;

export type NearCopies = { regions: CopiedRegion[] } | { skipped: string };

export function findNearCopies(gray: GrayImage): NearCopies {
  if (extremeShare(gray) > MAX_EXTREME_SHARE) {
    return { skipped: "The page is black and white only, so near copies can't be told from the same character printed twice." };
  }
  const cells = cellSums(gray);
  const { hashes, positions } = signatures(gray, cells);
  const votesByShift = new Map<number, number[]>();
  forEachRepeatGroup(hashes, positions, MAX_REPEATS, (group) => {
    for (let first = 0; first < group.length; first++) {
      for (let second = first + 1; second < group.length; second++) {
        const pair = evidenceShift(gray.width, group[first]!, group[second]!);
        if (pair) {
          (votesByShift.get(pair.shift) ?? votesByShift.set(pair.shift, []).get(pair.shift)!).push(pair.source);
        }
      }
    }
  });

  const regions = [...votesByShift.entries()]
    .filter(([, votes]) => votes.length >= MIN_VOTES)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_CANDIDATE_SHIFTS)
    .map(([shift, votes]) => regionFromPatch(gray, "near", shift, confirmedPatch(gray, cells, shift, votes), BLOCK))
    .filter((region) => region.matchingBlocks >= MIN_MATCHING_BLOCKS);
  return { regions };
}

function extremeShare({ pixels }: GrayImage) {
  let extremes = 0;
  for (const value of pixels) {
    if (value < EXTREME_MARGIN || value > 255 - EXTREME_MARGIN) {
      extremes++;
    }
  }
  return extremes / pixels.length;
}

/** For every position, the sum of the 3×3 cell of pixels starting there. */
function cellSums({ pixels, width, height }: GrayImage) {
  const sums = new Uint16Array(width * height);
  for (let y = 0; y + CELL <= height; y++) {
    for (let x = 0; x + CELL <= width; x++) {
      let sum = 0;
      for (let row = y; row < y + CELL; row++) {
        const start = row * width + x;
        sum += pixels[start]! + pixels[start + 1]! + pixels[start + 2]!;
      }
      sums[y * width + x] = sum;
    }
  }
  return sums;
}

/** The nine cell means of the block at a position. */
function cellMeans(cells: Uint16Array, width: number, position: number) {
  const means: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      means.push(cells[position + CELL * (row * width + column)]! / (CELL * CELL));
    }
  }
  return means;
}

function holdsCharacter(cells: Uint16Array, width: number, position: number) {
  const means = cellMeans(cells, width, position);
  return Math.max(...means) - Math.min(...means) >= MIN_CELL_RANGE;
}

/** A hash of each block's rounded cell means, for blocks that hold part of a character. */
function signatures({ width, height }: GrayImage, cells: Uint16Array) {
  const hashes = new GrowableArray();
  const positions = new GrowableArray();
  for (let y = 0; y + BLOCK <= height; y++) {
    for (let x = 0; x + BLOCK <= width; x++) {
      const position = y * width + x;
      const means = cellMeans(cells, width, position);
      if (Math.max(...means) - Math.min(...means) < MIN_CELL_RANGE) {
        continue;
      }
      let hash = 0;
      for (const mean of means) {
        hash = (Math.imul(hash, 0x01000193) + Math.floor(mean / SIGNATURE_STEP) + 1) | 0;
      }
      hashes.push(hash >>> 0);
      positions.push(position);
    }
  }
  return { hashes: hashes.values(), positions: positions.values() };
}

/**
 * Grows the largest patch of blocks that match their copy at this shift,
 * starting from the blocks that voted for it.
 */
function confirmedPatch(gray: GrayImage, cells: Uint16Array, shift: number, votes: number[]) {
  const { width, height } = gray;
  const shiftX = (shift % 65536) - 32768;
  const shiftY = Math.floor(shift / 65536);
  const offset = shiftY * width + shiftX;
  const length = Math.hypot(shiftX, shiftY);
  const nudge = Math.round((NUDGE * shiftY) / length) * width + Math.round((NUDGE * shiftX) / length);

  const fits = (position: number) => {
    const x = position % width;
    const y = Math.floor(position / width);
    return position >= 0 && x + BLOCK <= width && y + BLOCK <= height;
  };
  const isMatch = (position: number) =>
    fits(position) &&
    fits(position + offset) &&
    (position % width) + shiftX >= 0 &&
    holdsCharacter(cells, width, position) &&
    difference(gray, position, position + offset) <= MATCH_TOLERANCE &&
    !isAmbiguous(position);
  // An edge matches itself a little further along, and a dashed line or repeated heading matches again at twice the shift.
  const isAmbiguous = (position: number) =>
    [position + nudge, position + 2 * offset].some(
      (other) => fits(other) && difference(gray, position, other) <= AMBIGUITY * MATCH_TOLERANCE,
    );

  const seen = new Set<number>();
  let largest: number[] = [];
  for (const start of votes) {
    if (seen.has(start)) {
      continue;
    }
    seen.add(start);
    if (!isMatch(start)) {
      continue;
    }
    const patch = [start];
    for (let index = 0; index < patch.length; index++) {
      for (const neighbor of neighbors(patch[index]!, width)) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          if (isMatch(neighbor)) {
            patch.push(neighbor);
          }
        }
      }
    }
    if (patch.length > largest.length) {
      largest = patch;
    }
  }
  return largest;
}

/** Squared difference between two blocks as a share of the first block's variance. */
function difference({ pixels, width }: GrayImage, first: number, second: number) {
  let squaredDifference = 0;
  let sum = 0;
  let sumOfSquares = 0;
  for (let y = 0; y < BLOCK; y++) {
    for (let x = 0; x < BLOCK; x++) {
      const a = pixels[first + y * width + x]!;
      const b = pixels[second + y * width + x]!;
      squaredDifference += (a - b) ** 2;
      sum += a;
      sumOfSquares += a * a;
    }
  }
  const count = BLOCK * BLOCK;
  const variance = sumOfSquares / count - (sum / count) ** 2;
  return squaredDifference / count / Math.max(variance, 1);
}
