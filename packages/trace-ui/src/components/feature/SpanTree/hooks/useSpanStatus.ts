import type { SpanNode } from "@mg/trace/store";

export const ERROR_STATUS_CODE = 2;

export type SpanStatus = {
  isError: boolean;
  message?: string;
};

export const useSpanStatus = (node: SpanNode): SpanStatus => ({
  isError: node.status.code === ERROR_STATUS_CODE,
  message: node.status.message,
});
