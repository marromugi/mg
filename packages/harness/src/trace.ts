export type TraceAttributeValue = string | number | boolean;
export type TraceAttributes = Readonly<
  Record<string, TraceAttributeValue>
>;

export interface TraceSpan {
  startSpan(name: string, attributes?: TraceAttributes): TraceSpan;
  setAttributes(attributes: TraceAttributes): void;
  addEvent(name: string, attributes?: TraceAttributes): void;
  end(error?: unknown): void;
}

export const noopSpan: TraceSpan = {
  startSpan: () => noopSpan,
  setAttributes: () => {},
  addEvent: () => {},
  end: () => {},
};

export const withSpan = async <T>(
  parent: TraceSpan,
  name: string,
  attributes: TraceAttributes | undefined,
  fn: (span: TraceSpan) => Promise<T>,
): Promise<T> => {
  const span = parent.startSpan(name, attributes);

  try {
    const result = await fn(span);
    span.end();
    return result;
  } catch (error) {
    span.end(error);
    throw error;
  }
};
