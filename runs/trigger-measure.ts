import type { TraceAttributes, TraceSpan } from "@mg/harness";
import { ATTR, SPAN } from "@mg/trace";
import type { TextTriggerInput, Trigger } from "@mg/trigger";

export type LabelledInput = {
  expected: boolean;
  input: TextTriggerInput;
};

export type MeasuredRow = {
  expected: boolean;
  text: string;
  fired: boolean;
  probability: number;
};

export type MeasureSummary = {
  missed: number;
  falseFires: number;
  minExpectedTrue: number;
  maxExpectedFalse: number;
  gap: number;
  passed: boolean;
};

class RecordingSpan implements TraceSpan {
  readonly name: string;
  readonly attributes: TraceAttributes;
  readonly children: RecordingSpan[] = [];
  readonly setAttributesCalls: TraceAttributes[] = [];

  constructor(name: string, attributes?: TraceAttributes) {
    this.name = name;
    this.attributes = attributes ?? {};
  }

  startSpan(name: string, attributes?: TraceAttributes): TraceSpan {
    const child = new RecordingSpan(name, attributes);
    this.children.push(child);
    return child;
  }

  startRoot(name: string, attributes?: TraceAttributes): TraceSpan {
    return this.startSpan(name, attributes);
  }

  setAttributes(attributes: TraceAttributes): void {
    this.setAttributesCalls.push(attributes);
  }

  addEvent(): void {}

  end(): void {}

  get mergedAttributes(): TraceAttributes {
    return Object.assign(
      {},
      this.attributes,
      ...this.setAttributesCalls,
    );
  }
}

const measureOne = async (
  trigger: Trigger<TextTriggerInput>,
  labelled: LabelledInput,
): Promise<MeasuredRow> => {
  const span = new RecordingSpan("measure");
  const decision = await trigger.decide(labelled.input, {
    trace: span,
  });

  const triggerSpan = span.children.find(
    (child) => child.name === SPAN.trigger,
  );
  const probability =
    triggerSpan?.mergedAttributes[ATTR.triggerProbability];

  if (typeof probability !== "number") {
    throw new Error(
      `no probability was recorded for: ${labelled.input.text}`,
    );
  }

  return {
    expected: labelled.expected,
    text: labelled.input.text,
    fired: decision.fired,
    probability,
  };
};

export const measureTrigger = (
  trigger: Trigger<TextTriggerInput>,
  inputs: readonly LabelledInput[],
): Promise<MeasuredRow[]> =>
  Promise.all(inputs.map((labelled) => measureOne(trigger, labelled)));

export const summarize = (
  rows: readonly MeasuredRow[],
): MeasureSummary => {
  const expectedTrue = rows.filter((row) => row.expected);
  const expectedFalse = rows.filter((row) => !row.expected);

  if (expectedTrue.length === 0 || expectedFalse.length === 0) {
    throw new Error(
      "both expected-true and expected-false inputs are needed",
    );
  }

  const missed = expectedTrue.filter((row) => !row.fired).length;
  const falseFires = expectedFalse.filter((row) => row.fired).length;
  const minExpectedTrue = Math.min(
    ...expectedTrue.map((row) => row.probability),
  );
  const maxExpectedFalse = Math.max(
    ...expectedFalse.map((row) => row.probability),
  );

  return {
    missed,
    falseFires,
    minExpectedTrue,
    maxExpectedFalse,
    gap: minExpectedTrue - maxExpectedFalse,
    passed: missed === 0 && falseFires === 0,
  };
};
