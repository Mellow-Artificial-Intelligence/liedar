/**
 * Errors with a stable code, so scripts and agents can tell failures apart
 * without parsing messages.
 */

export type LiedarErrorCode =
  | "USAGE"
  | "FILE_NOT_FOUND"
  | "UNSUPPORTED_FILE_TYPE"
  | "INVALID_DOCUMENT"
  | "MISSING_API_KEY"
  | "INVALID_API_KEY"
  | "JEV_RATE_LIMITED"
  | "JEV_REQUEST_FAILED"
  | "JEV_BAD_RESPONSE"
  | "UNEXPECTED";

type LiedarErrorDetails = {
  /** What to do about it, when there's something to do. */
  fix?: string;
  /** Whether the same call may succeed if tried again later. */
  retryable?: boolean;
  cause?: unknown;
};

export class LiedarError extends Error {
  readonly code: LiedarErrorCode;
  readonly fix?: string;
  readonly retryable: boolean;

  constructor(code: LiedarErrorCode, message: string, { fix, retryable = false, cause }: LiedarErrorDetails = {}) {
    super(message, { cause });
    this.name = "LiedarError";
    this.code = code;
    this.fix = fix;
    this.retryable = retryable;
  }

  toJSON() {
    return { code: this.code, message: this.message, fix: this.fix, retryable: this.retryable };
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
