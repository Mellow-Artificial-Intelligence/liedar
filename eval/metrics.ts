/**
 * Metrics for scoring liedar against labeled documents. Each item pairs the
 * ground truth with a predicted probability of fraud.
 */
export type ScoredItem = { fraud: boolean; score: number };

export type Confusion = {
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  falsePositiveRate: number;
};

export type CalibrationBin = { from: number; to: number; count: number; meanScore: number; fraudRate: number };

/**
 * Area under the ROC curve: the chance a random fraudulent document scores
 * above a random genuine one, with ties counting half. NaN without both labels.
 */
export function auroc(items: ScoredItem[]): number {
  const sorted = [...items].sort((a, b) => a.score - b.score);
  const fraudCount = sorted.filter((item) => item.fraud).length;
  const genuineCount = sorted.length - fraudCount;
  if (fraudCount === 0 || genuineCount === 0) {
    return Number.NaN;
  }

  let fraudRankSum = 0;
  for (let start = 0; start < sorted.length; ) {
    let end = start;
    while (end < sorted.length && sorted[end]!.score === sorted[start]!.score) {
      end++;
    }
    // Tied scores share the average of the ranks they span (ranks start at 1).
    const averageRank = (start + 1 + end) / 2;
    for (let index = start; index < end; index++) {
      if (sorted[index]!.fraud) {
        fraudRankSum += averageRank;
      }
    }
    start = end;
  }
  return (fraudRankSum - (fraudCount * (fraudCount + 1)) / 2) / (fraudCount * genuineCount);
}

/** A 95% confidence interval for AUROC from resampling the items with replacement. */
export function aurocConfidenceInterval(items: ScoredItem[], resamples = 1000, seed = 1): [number, number] {
  const random = seededRandom(seed);
  const estimates: number[] = [];
  for (let resample = 0; resample < resamples; resample++) {
    const sample = items.map(() => items[Math.floor(random() * items.length)]!);
    const estimate = auroc(sample);
    if (!Number.isNaN(estimate)) {
      estimates.push(estimate);
    }
  }
  estimates.sort((a, b) => a - b);
  return [quantile(estimates, 0.025), quantile(estimates, 0.975)];
}

/** Counts and rates when scores at or above `threshold` are called fraud. */
export function confusionAt(items: ScoredItem[], threshold: number): Confusion {
  let truePositives = 0;
  let falsePositives = 0;
  let trueNegatives = 0;
  let falseNegatives = 0;
  for (const { fraud, score } of items) {
    const flagged = score >= threshold;
    if (fraud && flagged) truePositives++;
    else if (fraud) falseNegatives++;
    else if (flagged) falsePositives++;
    else trueNegatives++;
  }

  const precision = ratio(truePositives, truePositives + falsePositives);
  const recall = ratio(truePositives, truePositives + falseNegatives);
  return {
    truePositives,
    falsePositives,
    trueNegatives,
    falseNegatives,
    accuracy: ratio(truePositives + trueNegatives, items.length),
    precision,
    recall,
    f1: ratio(2 * precision * recall, precision + recall),
    falsePositiveRate: ratio(falsePositives, falsePositives + trueNegatives),
  };
}

/** The threshold that best separates the labels, by recall minus false positive rate (Youden's J). */
export function bestThreshold(items: ScoredItem[]): number {
  const candidates = [...new Set(items.map((item) => item.score))].sort((a, b) => a - b);
  let best = { threshold: 0.5, separation: Number.NEGATIVE_INFINITY };
  for (const threshold of candidates) {
    const { recall, falsePositiveRate } = confusionAt(items, threshold);
    if (recall - falsePositiveRate > best.separation) {
      best = { threshold, separation: recall - falsePositiveRate };
    }
  }
  return best.threshold;
}

/** Groups scores into equal-width bins, comparing each bin's mean score with how often it was really fraud. */
export function calibration(items: ScoredItem[], binCount = 10): CalibrationBin[] {
  return Array.from({ length: binCount }, (_, bin) => {
    const from = bin / binCount;
    const to = (bin + 1) / binCount;
    const inBin = items.filter(({ score }) => score >= from && (score < to || (bin === binCount - 1 && score <= to)));
    return {
      from,
      to,
      count: inBin.length,
      meanScore: mean(inBin.map((item) => item.score)),
      fraudRate: mean(inBin.map((item) => (item.fraud ? 1 : 0))),
    };
  });
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? Number.NaN : numerator / denominator;
}

function mean(values: number[]) {
  return ratio(
    values.reduce((sum, value) => sum + value, 0),
    values.length,
  );
}

function quantile(sortedValues: number[], fraction: number) {
  return sortedValues[Math.min(sortedValues.length - 1, Math.floor(fraction * sortedValues.length))] ?? Number.NaN;
}

/** Mulberry32, so confidence intervals come out the same on every run. */
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
