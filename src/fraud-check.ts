/**
 * Asks Jev (TypeSafe AI) whether a document is likely fraudulent, and how
 * likely each common fraud signal is to be present.
 */
import type { LoadedDocument } from "./document.ts";
import { askJev, type JevOptions, type JevQuestion, type JevState } from "./jev.ts";

/** A signal at or above this probability is reported as a reason. */
export const REASON_THRESHOLD = 0.5;

const FRAUD_SIGNALS = {
  editingSoftware: {
    label: "Made or edited with editing software",
    instructions:
      "Does the metadata show the file was created or modified with image or PDF editing software (such as Photoshop, GIMP, Canva, or an online PDF editor) rather than the system that would normally issue this kind of document?",
  },
  modifiedAfterCreation: {
    label: "Modified after it was created",
    instructions:
      "Does the metadata show the file was changed after it was first created, such as a modification date later than the creation date, more than one saved version, or an edit history?",
  },
  conflictingDates: {
    label: "Conflicting or impossible dates",
    instructions:
      "Do the dates conflict, such as dates printed on the document that don't match the metadata dates, dates in the future, or dates that are out of order?",
  },
  visualTampering: {
    label: "Visual signs of tampering",
    instructions:
      "Do the page images show signs of tampering, such as mismatched fonts, misaligned or uneven text, inconsistent spacing, blurred or pixelated patches, or areas that look pasted in?",
  },
  numbersDontReconcile: {
    label: "Numbers don't add up",
    instructions:
      "Do the numbers fail to reconcile, such as line items, subtotals, taxes, balances, or totals that don't add up?",
  },
  implausibleDetails: {
    label: "Implausible or invalid details",
    instructions:
      "Does any content look invalid or implausible, such as malformed account, tax, or reference numbers, or names, addresses, and amounts that are inconsistent with each other?",
  },
  inauthenticLayout: {
    label: "Layout doesn't match a genuine issuer",
    instructions:
      "Do the logos, layout, or formatting look inconsistent with a genuine document from the stated issuer, or like a generic template?",
  },
} as const;

type SignalKey = keyof typeof FRAUD_SIGNALS;

const QUESTIONS = {
  likelyFraud: {
    instructions:
      "Considering the page images and the file metadata together, is this document likely fraudulent, forged, or altered from its original?",
    criteria: {
      true: "Likely fraudulent, forged, or tampered with",
      false: "Likely an authentic, unaltered document",
    },
  },
  ...Object.fromEntries(Object.entries(FRAUD_SIGNALS).map(([key, { instructions }]) => [key, { instructions }])),
} as Record<"likelyFraud" | SignalKey, JevQuestion>;

export type FraudReason = { key: SignalKey; label: string; confidence: number };

export type FraudReport = {
  likelyFraud: boolean;
  /** Jev's probability that the document is fraudulent. */
  fraudProbability: number;
  /** Signals at or above the threshold, most likely first. */
  reasons: FraudReason[];
  /** Every signal, most likely first. */
  signals: FraudReason[];
};

/** Check one document. */
export async function checkDocument(document: LoadedDocument, options: JevOptions = {}): Promise<FraudReport> {
  const { likelyFraud, ...signalAnswers } = await askJev(buildState(document), QUESTIONS, options);
  const signals = (Object.keys(FRAUD_SIGNALS) as SignalKey[])
    .map((key) => ({
      key,
      label: FRAUD_SIGNALS[key].label,
      confidence: signalAnswers[key],
    }))
    .sort((a, b) => b.confidence - a.confidence);

  return {
    likelyFraud: likelyFraud >= REASON_THRESHOLD,
    fraudProbability: likelyFraud,
    reasons: signals.filter((signal) => signal.confidence >= REASON_THRESHOLD),
    signals,
  };
}

function buildState({ metadata, pages, totalPages }: LoadedDocument): JevState {
  const skippedPages = totalPages - pages.length;
  return [
    "A document submitted for a fraud review. Its file metadata comes first, followed by an image of each page in order." +
      (skippedPages > 0 ? ` Only the first ${pages.length} of ${totalPages} pages are included.` : ""),
    JSON.stringify(metadata),
    ...pages,
  ];
}
