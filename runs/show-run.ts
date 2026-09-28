import type { HarnessEvent } from "@mg/harness";
import type { Term } from "@mg/term";
import { term as defaultTerm } from "@mg/term";

export type RunStart = (
  onEvent: (event: HarnessEvent) => void,
) => Promise<{ sessionId: string }>;

export type ShowRunOptions = {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  term?: Term;
};

function toolResultLines(content: string): string[] {
  const trimmed = content.endsWith("\n")
    ? content.slice(0, -1)
    : content;
  return trimmed.split("\n");
}

export async function showRun(
  start: RunStart,
  options?: ShowRunOptions,
): Promise<0 | 1> {
  const stdout =
    options?.stdout ?? ((text) => process.stdout.write(text));
  const stderr =
    options?.stderr ?? ((text) => process.stderr.write(text));
  const term = options?.term ?? defaultTerm;

  let atLineStart = true;

  const onEvent = (event: HarnessEvent): void => {
    if (event.type === "text-delta") {
      stdout(event.delta);
      if (event.delta !== "") atLineStart = event.delta.endsWith("\n");
    } else if (event.type === "tool-call") {
      if (!atLineStart) stdout("\n");
      const { name, arguments: args } = event.toolCall;
      const line = `${term.mark.muted} ${name} ${JSON.stringify(args)}`;
      stdout(`${term.paint("muted", line)}\n`);
      atLineStart = true;
    } else if (event.type === "tool-result") {
      if (!atLineStart) stdout("\n");
      for (const resultLine of toolResultLines(event.message.content)) {
        stdout(`${term.paint("muted", `  ${resultLine}`)}\n`);
      }
      atLineStart = true;
    }
  };

  try {
    const { sessionId } = await start(onEvent);
    if (!atLineStart) stdout("\n");
    const line = `${term.mark.success} sessionId: ${sessionId}`;
    stdout(`${term.paint("success", line)}\n`);
    return 0;
  } catch (error) {
    if (!atLineStart) stdout("\n");
    const line = `${term.mark.error} ${describeError(error)}`;
    stderr(`${term.paint("error", line)}\n`);
    return 1;
  }
}

function safeRead<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function describeValue(value: unknown, seen: Set<Error>): string {
  if (value instanceof Error) {
    if (seen.has(value)) return "(循環)";
    seen.add(value);

    const name = safeRead(() => value.name, "Error");
    const message = safeRead(() => value.message, "?");
    const kind = safeRead(
      () => (value as { kind?: unknown }).kind,
      undefined,
    );
    const label = typeof kind === "string" ? `${name}(${kind})` : name;
    const head = `${label}: ${message}`;

    const cause = safeRead(
      () => (value as { cause?: unknown }).cause,
      undefined,
    );
    if (cause === undefined) return head;
    return `${head} ← ${describeValue(cause, seen)}`;
  }

  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    json = undefined;
  }
  if (json !== undefined) return json;

  let str: string;
  try {
    str = String(value);
  } catch {
    str = "?";
  }
  return `<JSON にできない値: ${str}>`;
}

export function describeError(error: unknown): string {
  return describeValue(error, new Set()).replace(/\n/g, "\\n");
}
