/**
 * Library entry point:
 *
 *   const report = await checkDocument(await loadDocument("invoice.pdf"));
 */
export { loadDocument, MAX_PAGES, type LoadedDocument } from "./document.ts";
export { LiedarError, type LiedarErrorCode } from "./errors.ts";
export { checkDocument, REASON_THRESHOLD, type FraudReason, type FraudReport, type SignalCategory } from "./fraud-check.ts";
export type { DecisionOptions, ReliabilityScore } from "./decisions.ts";
export type { PageImage } from "./page-image.ts";
export { resolveProvider, type CheckOptions } from "./provider.ts";
export type { Provider } from "./assessment.ts";
/** @deprecated Use CheckOptions with provider: "typesafe". */
export type { DecisionOptions as JevOptions } from "./decisions.ts";
