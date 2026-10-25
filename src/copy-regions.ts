/**
 * Shared pieces of liedar's copied-region checks: the image and region types,
 * which shifts between two blocks can be evidence, grouping blocks by hash,
 * and turning a patch of matching blocks into a region.
 */
export type GrayImage = { pixels: Uint8Array; width: number; height: number };

/** A rectangle as fractions of the page's width and height, so it lines up with any copy of the page. */
export type Box = { left: number; top: number; width: number; height: number };

export type CopiedRegion = {
  /** "exact" when the copy matches pixel for pixel; "near" when it matches up to JPEG compression. */
  match: "exact" | "near";
  source: Box;
  copy: Box;
  matchingBlocks: number;
};

/** Positions are packed into 27 bits next to a hash, covering images up to 134 megapixels. */
export const POSITION_BITS = 2 ** 27;
/** Shorter shifts are a stroke matching itself. */
const MIN_SHIFT = 16;
const JPEG_TILE = 8;

/**
 * The shift from one block to another, pointing down or right and packed into
 * one number, with the block it starts from. Undefined when the shift can't be
 * evidence of a copy.
 */
export function evidenceShift(width: number, first: number, second: number) {
  let x = (second % width) - (first % width);
  let y = Math.floor(second / width) - Math.floor(first / width);
  let source = first;
  if (y < 0 || (y === 0 && x < 0)) {
    [x, y, source] = [-x, -y, second];
  }
  // JPEG compresses in 8×8 tiles and decodes flat tiles identically, so shifts on that grid aren't evidence.
  const onJpegGrid = x % JPEG_TILE === 0 && y % JPEG_TILE === 0;
  if (Math.max(Math.abs(x), y) < MIN_SHIFT || onJpegGrid) {
    return undefined;
  }
  return { shift: y * 65536 + x + 32768, source };
}

export function unpackShift(shift: number) {
  return { x: (shift % 65536) - 32768, y: Math.floor(shift / 65536) };
}

/**
 * Calls `visit` with the positions of each group of blocks that share a hash,
 * skipping groups larger than `maxRepeats`, which are patterns such as ruled
 * lines. Returns the share of blocks that repeat at all.
 */
export function forEachRepeatGroup(
  hashes: Uint32Array,
  positions: Uint32Array,
  maxRepeats: number,
  visit: (group: number[]) => void,
) {
  // Sorting hash and position packed into one number groups equal hashes without a comparator,
  // keeping 26 bits of hash within a double's precision.
  const count = hashes.length;
  const keys = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    keys[index] = (hashes[index]! >>> 6) * POSITION_BITS + positions[index]!;
  }
  keys.sort();

  let repeatingBlocks = 0;
  for (let start = 0; start < count; ) {
    const hash = Math.floor(keys[start]! / POSITION_BITS);
    let end = start + 1;
    while (end < count && Math.floor(keys[end]! / POSITION_BITS) === hash) {
      end++;
    }
    if (end - start > 1) {
      repeatingBlocks += end - start;
    }
    if (end - start > 1 && end - start <= maxRepeats) {
      visit(Array.from(keys.subarray(start, end), (key) => key % POSITION_BITS));
    }
    start = end;
  }
  return count === 0 ? 0 : repeatingBlocks / count;
}

/** A region from the source positions of a patch of matching blocks and the shift to their copy. */
export function regionFromPatch(
  { width, height }: GrayImage,
  match: CopiedRegion["match"],
  shift: number,
  patch: number[],
  blockSize: number,
): CopiedRegion {
  const { x: shiftX, y: shiftY } = unpackShift(shift);
  const xs = patch.map((position) => position % width);
  const ys = patch.map((position) => Math.floor(position / width));
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const boxWidth = Math.max(...xs) - left + blockSize;
  const boxHeight = Math.max(...ys) - top + blockSize;
  const box = (x: number, y: number): Box => ({
    left: fraction(x, width),
    top: fraction(y, height),
    width: fraction(boxWidth, width),
    height: fraction(boxHeight, height),
  });
  return { match, source: box(left, top), copy: box(left + shiftX, top + shiftY), matchingBlocks: patch.length };
}

/** Scattered chance matches can share a shift with a real copy; a copy's blocks touch each other. */
export function largestConnectedPatch(positions: number[], width: number) {
  const remaining = new Set(positions);
  let largest: number[] = [];
  for (const start of positions) {
    if (!remaining.delete(start)) {
      continue;
    }
    const patch = [start];
    for (let index = 0; index < patch.length; index++) {
      for (const neighbor of neighbors(patch[index]!, width)) {
        if (remaining.delete(neighbor)) {
          patch.push(neighbor);
        }
      }
    }
    if (patch.length > largest.length) {
      largest = patch;
    }
  }
  return largest;
}

export function neighbors(position: number, width: number) {
  return [position - 1, position + 1, position - width, position + width];
}

/** Rounded to a tenth of a percent, which is finer than the model can point at. */
function fraction(pixels: number, total: number) {
  return Math.round((pixels / total) * 1000) / 1000;
}

/** A Uint32Array that doubles as it fills, since the number of blocks to hash isn't known up front. */
export class GrowableArray {
  private buffer = new Uint32Array(1 << 16);
  length = 0;

  push(value: number) {
    if (this.length === this.buffer.length) {
      const larger = new Uint32Array(this.buffer.length * 2);
      larger.set(this.buffer);
      this.buffer = larger;
    }
    this.buffer[this.length++] = value;
  }

  values() {
    return this.buffer.subarray(0, this.length);
  }
}
