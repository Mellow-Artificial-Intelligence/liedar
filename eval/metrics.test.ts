import { describe, expect, test } from "bun:test";
import { auroc, aurocConfidenceInterval, bestThreshold, calibration, confusionAt, type ScoredItem } from "./metrics.ts";

const fraud = (score: number): ScoredItem => ({ fraud: true, score });
const genuine = (score: number): ScoredItem => ({ fraud: false, score });

describe("auroc", () => {
  test("is 1 when every fraud scores above every genuine document", () => {
    expect(auroc([fraud(0.9), fraud(0.6), genuine(0.5), genuine(0.1)])).toBe(1);
  });

  test("is 0.5 when the scores don't separate the labels", () => {
    expect(auroc([fraud(0.5), fraud(0.5), genuine(0.5), genuine(0.5)])).toBe(0.5);
  });

  test("counts the share of fraud and genuine pairs ranked correctly, ties as half", () => {
    // Pairs: 0.8 beats 0.6 and 0.3; 0.6 ties 0.6 and beats 0.3; 0.2 loses both. (2 + 1.5) / 6.
    expect(auroc([fraud(0.8), fraud(0.6), fraud(0.2), genuine(0.6), genuine(0.3)])).toBeCloseTo(3.5 / 6);
  });

  test("is NaN with only one label", () => {
    expect(auroc([fraud(0.9), fraud(0.1)])).toBeNaN();
  });
});

describe("aurocConfidenceInterval", () => {
  test("brackets the estimate and is the same on every run", () => {
    const items = Array.from({ length: 40 }, (_, index) => (index % 2 ? fraud(index / 40) : genuine(index / 50)));
    const [low, high] = aurocConfidenceInterval(items);
    expect(low).toBeLessThanOrEqual(auroc(items));
    expect(high).toBeGreaterThanOrEqual(auroc(items));
    expect(aurocConfidenceInterval(items)).toEqual([low, high]);
  });
});

describe("confusionAt", () => {
  test("calls scores at or above the threshold fraud", () => {
    const confusion = confusionAt([fraud(0.9), fraud(0.5), fraud(0.2), genuine(0.7), genuine(0.1)], 0.5);
    expect(confusion).toMatchObject({ truePositives: 2, falseNegatives: 1, falsePositives: 1, trueNegatives: 1 });
    expect(confusion.recall).toBeCloseTo(2 / 3);
    expect(confusion.precision).toBeCloseTo(2 / 3);
    expect(confusion.falsePositiveRate).toBe(0.5);
    expect(confusion.accuracy).toBe(0.6);
  });
});

describe("bestThreshold", () => {
  test("finds the score that separates the labels", () => {
    expect(bestThreshold([fraud(0.3), fraud(0.25), genuine(0.2), genuine(0.05)])).toBe(0.25);
  });
});

describe("calibration", () => {
  test("bins scores and compares each bin's mean with its fraud rate", () => {
    const bins = calibration([fraud(0.95), genuine(0.92), fraud(1), genuine(0.05)], 2);
    expect(bins.map(({ count, fraudRate }) => [count, fraudRate])).toEqual([
      [1, 0],
      [3, 2 / 3],
    ]);
  });
});
