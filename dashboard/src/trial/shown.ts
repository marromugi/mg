// How one piece of a tool call is shown: what the tool was given, or
// what it gave back. Each kind is one way of showing. Code whose lines
// are numbered says which number its first line has.
export type Shown = {
  kind: "code";
  language: string;
  text: string;
  startLine?: number;
};

// How one tool's calls are shown, decided from what the tool was
// given. `subject` is what the call acts on, in a few words.
type Presenter = {
  subject: (args: Args) => string | undefined;
  input: (args: Args) => Shown;
  result: (args: Args, text: string) => Shown;
};

type Args = Record<string, unknown>;

const LANGUAGES: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  jsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
};

const text = (args: Args, key: string): string | undefined => {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
};

// The language a file is written in, read from the end of its name. A
// file with an ending this does not know is plain text.
const languageOf = (path: string | undefined): string => {
  const ending = path?.split("/").pop()?.split(".").pop() ?? "";
  return LANGUAGES[ending.toLowerCase()] ?? "text";
};

const json = (args: Args): Shown => ({
  kind: "code",
  language: "json",
  text: JSON.stringify(args, null, 2),
});

const plain = (_args: Args, result: string): Shown => ({
  kind: "code",
  language: "text",
  text: result,
});

const NUMBERED = /^(\d+)\t(.*)$/;

// A result whose every line starts with its number, one after another,
// as the file's own lines and the number of the first. Anything else,
// such as a result cut short with a note or an error, is undefined.
const numberedLines = (
  result: string,
): { startLine: number; text: string } | undefined => {
  const lines: string[] = [];
  let startLine: number | undefined;
  for (const line of result.split("\n")) {
    const match = NUMBERED.exec(line);
    if (match === null) return undefined;
    const number = Number(match[1]);
    startLine ??= number;
    if (number !== startLine + lines.length) return undefined;
    lines.push(match[2] ?? "");
  }
  return startLine === undefined
    ? undefined
    : { startLine, text: lines.join("\n") };
};

const PRESENTERS: Record<string, Presenter> = {
  read_file: {
    subject: (args) => text(args, "path"),
    input: json,
    result: (args, result) => {
      const numbered = numberedLines(result);
      return numbered === undefined
        ? plain(args, result)
        : {
            kind: "code",
            language: languageOf(text(args, "path")),
            ...numbered,
          };
    },
  },
  write_file: {
    subject: (args) => text(args, "path"),
    input: (args) => {
      const content = text(args, "content");
      return content === undefined
        ? json(args)
        : {
            kind: "code",
            language: languageOf(text(args, "path")),
            text: content,
          };
    },
    result: plain,
  },
  edit_file: {
    subject: (args) => text(args, "path"),
    input: json,
    result: plain,
  },
  grep: {
    subject: (args) => text(args, "pattern"),
    input: json,
    result: plain,
  },
  bash: {
    subject: (args) => text(args, "command"),
    input: (args) => {
      const command = text(args, "command");
      return command === undefined
        ? json(args)
        : { kind: "code", language: "shellscript", text: command };
    },
    result: plain,
  },
};

const UNKNOWN: Presenter = {
  subject: () => undefined,
  input: json,
  result: plain,
};

const argsOf = (input: unknown): Args =>
  typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Args)
    : { input };

// How a call of the named tool is shown. A tool with no presenter of
// its own shows what it was given as JSON and what it gave back as
// plain text.
export const presentCall = (
  name: string,
  input: unknown,
): {
  subject?: string;
  input: Shown;
  result: (text: string) => Shown;
} => {
  const presenter = PRESENTERS[name] ?? UNKNOWN;
  const args = argsOf(input);
  const subject = presenter.subject(args);
  return {
    ...(subject === undefined ? {} : { subject }),
    input: presenter.input(args),
    result: (result) => presenter.result(args, result),
  };
};
