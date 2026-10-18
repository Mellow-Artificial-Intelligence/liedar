/**
 * Library entry point:
 *
 *   const report = await checkDocument(await loadDocument("invoice.pdf"));
 */
export { loadDocument, MAX_PAGES, type LoadedDocument } from "./document.ts";
export { ForgedError, type ForgedErrorCode } from "./errors.ts";
export { checkDocument, REASON_THRESHOLD, type FraudReason, type FraudReport } from "./fraud-check.ts";
export type { JevOptions } from "./jev.ts";
export type { PageImage } from "./page-image.ts";
