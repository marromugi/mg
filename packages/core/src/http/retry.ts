import { readRetryAfterMs } from "./retry-after.js";

export type RetryMark =
  { retryable: true; retryAfterMs?: number } | { retryable: false };

// RFC 9110: 408 and 429 may be repeated, and so may server errors.
export const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 429 || (status >= 500 && status <= 599);

const SEND_RETRYABLE_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const BODY_CUT_CODE = "UND_ERR_SOCKET";

// AggregateError の cause も code を持ちます。
const causeCode = (error: unknown): unknown => {
  if (typeof error !== "object" || error === null) return undefined;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause !== "object" || cause === null) return undefined;
  return (cause as { code?: unknown }).code;
};

export const isRetryableSendFailure = (error: unknown): boolean => {
  const code = causeCode(error);
  return typeof code === "string" && SEND_RETRYABLE_CODES.has(code);
};

export const isConnectionCut = (error: unknown): boolean =>
  causeCode(error) === BODY_CUT_CODE;

export const retryMarkForStatus = (response: Response): RetryMark => {
  if (!isRetryableStatus(response.status)) {
    return { retryable: false };
  }
  const retryAfterMs = readRetryAfterMs(
    response.headers.get("Retry-After"),
  );
  return retryAfterMs === undefined
    ? { retryable: true }
    : { retryable: true, retryAfterMs };
};
