import {
  type RetryMark,
  isConnectionCut,
  isRetryableSendFailure,
  retryMarkForStatus,
} from "../http/retry.js";

export type { RetryMark };

export const NOT_RETRYABLE: RetryMark = { retryable: false };

export const sendFailureMark = (error: unknown): RetryMark =>
  isRetryableSendFailure(error) ? { retryable: true } : NOT_RETRYABLE;

export const bodyReadFailureMark = (error: unknown): RetryMark =>
  isConnectionCut(error) ? { retryable: true } : NOT_RETRYABLE;

export const statusMark = retryMarkForStatus;
