export type LevelArgument =
  { ok: true; levelDb: number } | { ok: false; usage: string };

// The loudness level given on the command line, in dB. Without one it is
// `fallback`. Anything that is not a number gives `usage`.
export const readLevel = (
  argument: string | undefined,
  fallback: number,
  usage: string,
): LevelArgument => {
  if (argument === undefined) return { ok: true, levelDb: fallback };
  const levelDb = argument.trim() === "" ? NaN : Number(argument);
  return Number.isFinite(levelDb)
    ? { ok: true, levelDb }
    : { ok: false, usage };
};
