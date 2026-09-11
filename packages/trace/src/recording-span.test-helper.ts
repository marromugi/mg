import type { TraceAttributes, TraceSpan } from "@mg/harness";

export class RecordingSpan implements TraceSpan {
  readonly name: string;
  readonly attributes: TraceAttributes;
  readonly children: RecordingSpan[] = [];
  readonly events: { name: string; attributes?: TraceAttributes }[] = [];
  readonly setAttributesCalls: TraceAttributes[] = [];
  readonly endCalls: unknown[] = [];

  constructor(name: string, attributes?: TraceAttributes) {
    this.name = name;
    this.attributes = attributes ?? {};
  }

  startSpan(name: string, attributes?: TraceAttributes): TraceSpan {
    const child = new RecordingSpan(name, attributes);
    this.children.push(child);
    return child;
  }

  setAttributes(attributes: TraceAttributes): void {
    this.setAttributesCalls.push(attributes);
  }

  addEvent(name: string, attributes?: TraceAttributes): void {
    this.events.push({ name, attributes });
  }

  end(error?: unknown): void {
    this.endCalls.push(error);
  }

  get ended(): boolean {
    return this.endCalls.length > 0;
  }

  get mergedAttributes(): TraceAttributes {
    return Object.assign({}, this.attributes, ...this.setAttributesCalls);
  }
}
