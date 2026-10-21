/**
 * Asks Jev (TypeSafe AI) how likely each common fraud signal is to be present
 * in a document, and calls it likely fraud when any signal is.
 */
import type { LoadedDocument } from "./document.ts";
import { askJev, JEV_MODEL, type JevOptions, type JevQuestion, type JevState } from "./jev.ts";

/**
 * At or above this probability, the verdict is fraud and a signal is reported
 * as a reason. Chosen on the eval's training split, where weaker answers came
 * mostly from genuine documents.
 */
export const REASON_THRESHOLD = 0.75;

const FRAUD_SIGNALS = {
  editingSoftware: {
    label: "Made or edited with editing software",
    instructions:
      "Does the metadata show the file was created or modified with image or PDF editing software (such as Photoshop, GIMP, Paint, Canva, or an online PDF editor) rather than the system that would normally issue this kind of document, or does the image have properties a scanner or camera wouldn't produce, such as a transparency (alpha) channel?",
  },
  modifiedAfterCreation: {
    label: "Modified after it was created",
    instructions:
      "Does the metadata show the document's content was edited after it was first created, such as more than one saved version, an edit history, or a modification date later than the creation date in a PDF? A file whose creation date is later than its modification date was usually copied or converted, which is normal.",
  },
  conflictingDates: {
    label: "Conflicting or impossible dates",
    instructions:
      "Do the dates printed on the document conflict with each other or with the metadata, such as a date that doesn't exist, a date in the future, a due date before the issue date, or a file created before the transaction it records? Files are often scanned, copied, or converted long after the document was issued, and copying or converting can leave a creation date later than the modification date. Neither is a conflict.",
  },
  copiedRegion: {
    label: "Part of a page was pasted from elsewhere on it",
    instructions:
      "Did liedar's pixel analysis find an exact copy: a region of a page that duplicates another region of the same page pixel for pixel? A scanned or photographed page never repeats itself exactly, so an exact copy was pasted in. Check its close-up: a copy over an amount, date, name, or number is strong evidence of alteration. Answer no if the analysis found no exact copies or couldn't check.",
  },
  nearCopiedRegion: {
    label: "Part of a page closely matches another part of it",
    instructions:
      "Did liedar's pixel analysis find a near copy, matching another region of the same page up to JPEG compression, that sits on a figure someone would change, such as an amount, date, or number? The same character printed twice in a crisp font can match that closely too, so a near copy on a letter repeated within a word or a line of ordinary text doesn't count. Check its close-up. Answer no if the analysis found no near copies or couldn't check.",
  },
  visualTampering: {
    label: "Visual signs of tampering",
    instructions:
      "Do the page images show signs of tampering, such as mismatched fonts, misaligned or uneven text, inconsistent spacing, blurred or pixelated patches, or areas that look pasted in?",
  },
  numbersDontReconcile: {
    label: "Line items don't add up",
    instructions:
      "Do the line items fail to add up: a line's quantity times unit price differing from its amount, or the line amounts not summing to the subtotal or total printed on the document? Answer no if the document has no line items.",
  },
  taxDoesntMatchRate: {
    label: "Tax doesn't match its rate",
    instructions:
      "Does the document show a tax rate, the amount it applies to, and a tax amount, where the rate applied to that amount differs from the tax amount by more than rounding to the smallest coin? Answer no if any of the three is missing.",
  },
  paymentDoesntAddUp: {
    label: "Payment or balance doesn't add up",
    instructions:
      "Does the document show a payment or balance calculation that doesn't add up, such as the amount tendered minus the total not equaling the change, or a balance that doesn't carry forward from the amounts before it? Answer no if the document shows no such calculation.",
  },
  implausibleDetails: {
    label: "Implausible or invalid details",
    instructions:
      "Is a specific detail clearly invalid or contradicted, such as an account, tax, or registration number in an impossible format, or a name, address, or reference number that differs from the same detail elsewhere on the document? Print defects, abbreviations, and unfamiliar local formats don't count.",
  },
  inauthenticLayout: {
    label: "Layout doesn't match a genuine issuer",
    instructions:
      "Do the logos, layout, or formatting look inconsistent with a genuine document from the stated issuer, or like a generic template?",
  },
} as const;

type SignalKey = keyof typeof FRAUD_SIGNALS;

const QUESTIONS = Object.fromEntries(
  Object.entries(FRAUD_SIGNALS).map(([key, { instructions }]) => [key, { instructions }]),
) as Record<SignalKey, JevQuestion>;

export type FraudReason = {
  key: SignalKey;
  label: string;
  /** The yes/no question Jev was asked. */
  question: string;
  /** Jev's probability that the answer is yes. */
  confidence: number;
};

export type FraudReport = {
  likelyFraud: boolean;
  /**
   * The strongest signal's confidence: a document is as suspect as its
   * strongest evidence. Not calibrated, so it isn't the chance of fraud.
   */
  fraudProbability: number;
  /** Signals at or above the threshold, most likely first. */
  reasons: FraudReason[];
  /** Every signal, most likely first. */
  signals: FraudReason[];
  /** The probability at or above which the verdict is fraud and a signal is a reason. */
  threshold: number;
  model: string;
  /** Pages sent to Jev, which can be fewer than the document has. */
  pagesChecked: number;
  totalPages: number;
};

/** Check one document. */
export async function checkDocument(document: LoadedDocument, options: JevOptions = {}): Promise<FraudReport> {
  const answers = await askJev(buildState(document), QUESTIONS, options);
  const signals = (Object.keys(FRAUD_SIGNALS) as SignalKey[])
    .map((key) => ({
      key,
      label: FRAUD_SIGNALS[key].label,
      question: FRAUD_SIGNALS[key].instructions,
      confidence: answers[key],
    }))
    .sort((a, b) => b.confidence - a.confidence);

  const fraudProbability = signals[0]!.confidence;

  return {
    likelyFraud: fraudProbability >= REASON_THRESHOLD,
    fraudProbability,
    reasons: signals.filter((signal) => signal.confidence >= REASON_THRESHOLD),
    signals,
    threshold: REASON_THRESHOLD,
    model: JEV_MODEL,
    pagesChecked: document.pages.length,
    totalPages: document.totalPages,
  };
}

function buildState({ metadata, pages, totalPages, analysis, closeUps }: LoadedDocument): JevState {
  const skippedPages = totalPages - pages.length;
  return [
    "A document submitted for a fraud review. Its file metadata comes first, then an image of each page in order, then what liedar's pixel analysis found." +
      (skippedPages > 0 ? ` Only the first ${pages.length} of ${totalPages} pages are included.` : ""),
    JSON.stringify(metadata),
    ...pages,
    `Pixel analysis. Boxes are fractions of the page's width and height from its top left corner: ${JSON.stringify(analysis)}`,
    ...closeUps.flatMap((image, index) => [
      `Close-up of copied region ${index + 1}: on the left, the source and the page around it; on the right, its ${copyMatch(analysis, index)} copy and the page around that.`,
      image,
    ]),
  ];
}

function copyMatch({ copiedRegions }: LoadedDocument["analysis"], index: number) {
  return copiedRegions.checked && copiedRegions.copiedRegions[index]?.match === "near" ? "near" : "exact";
}
