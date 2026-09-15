export type Tone = "success" | "error" | "warn" | "muted" | "strong";

export type TermOptions = {
  isTTY?: boolean;
  env?: Record<string, string | undefined>;
};

export type Term = {
  readonly colorEnabled: boolean;
  readonly mark: Readonly<Record<Tone, string>>;
  paint: (tone: Tone, text: string) => string;
};

const marks: Readonly<Record<Tone, string>> = {
  success: "✅",
  error: "❌",
  warn: "⚠️",
  muted: "▫️",
  strong: "▶️",
};

const ansiCodes: Readonly<Record<Tone, string>> = {
  success: "\x1b[32m",
  error: "\x1b[31m",
  warn: "\x1b[33m",
  muted: "\x1b[2m",
  strong: "\x1b[1m",
};

const reset = "\x1b[0m";

function resolveColorEnabled(
  isTTY: boolean,
  env: Record<string, string | undefined>,
): boolean {
  const forceColor = env.FORCE_COLOR;
  if (
    forceColor !== undefined &&
    forceColor !== "" &&
    forceColor !== "0"
  ) {
    return true;
  }
  if (env.NO_COLOR !== undefined) {
    return false;
  }
  return isTTY;
}

export function createTerm(options: TermOptions = {}): Term {
  const stdoutIsTTY = process.stdout.isTTY as boolean | undefined;
  const isTTY = options.isTTY ?? stdoutIsTTY ?? false;
  const env = options.env ?? process.env;
  const colorEnabled = resolveColorEnabled(isTTY, env);

  return {
    colorEnabled,
    mark: marks,
    paint(tone: Tone, text: string): string {
      if (!colorEnabled) {
        return text;
      }
      return `${ansiCodes[tone]}${text}${reset}`;
    },
  };
}

export const term: Term = createTerm();
