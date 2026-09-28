export type OneInput =
  { ok: true; input: string } | { ok: false; usage: string };

export function readOneInput(
  args: readonly string[],
  entry: string,
): OneInput {
  if (args.length !== 1) {
    return { ok: false, usage: `usage: node ${entry} "<input>"` };
  }
  return { ok: true, input: args[0] };
}
