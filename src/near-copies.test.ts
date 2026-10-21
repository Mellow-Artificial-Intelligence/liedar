import { describe, expect, test } from "bun:test";
import { findNearCopies } from "./near-copies.ts";

describe("findNearCopies", () => {
  test("skips a black and white page, where every printing of a character is identical", () => {
    const width = 200;
    const height = 200;
    const pixels = new Uint8Array(width * height).map((_, index) => ((index % width) % 20 < 4 ? 0 : 255));
    expect(findNearCopies({ pixels, width, height })).toEqual({ skipped: expect.stringContaining("black and white") });
  });
});
