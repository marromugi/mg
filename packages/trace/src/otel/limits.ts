import type {
  GeneralLimits,
  SpanLimits,
} from "@opentelemetry/sdk-trace-base";

// The SDK's own defaults for an empty environment, fixed here so the
// environment cannot change them.
export const spanLimits: Required<SpanLimits> = {
  attributeValueLengthLimit: Infinity,
  attributeCountLimit: 128,
  eventCountLimit: 128,
  linkCountLimit: 128,
  attributePerEventCountLimit: 128,
  attributePerLinkCountLimit: 128,
};

export const generalLimits: Required<GeneralLimits> = {
  attributeValueLengthLimit: Infinity,
  attributeCountLimit: 128,
};
