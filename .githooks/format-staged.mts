// Formats the staged content of each staged file and puts the result back
// into the index. The working tree copy is rewritten only when it has no
// unstaged changes, so a partly staged file keeps the rest out of the commit.

import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import * as prettier from "prettier";

const UNFORMATTABLE_MODES = new Set(["120000", "160000"]);

const git = (args: readonly string[], input?: string): string =>
  execFileSync("git", args, {
    encoding: "utf8",
    input,
    maxBuffer: 256 * 1024 * 1024,
  });

const hasUnstagedChanges = (file: string): boolean =>
  spawnSync("git", ["diff", "--quiet", "--", file]).status !== 0;

const stagedFiles = git([
  "diff",
  "--cached",
  "--name-only",
  "--diff-filter=ACMR",
  "-z",
])
  .split("\0")
  .filter((file) => file !== "");

for (const file of stagedFiles) {
  const mode = git(["ls-files", "--stage", "--", file]).split(" ")[0];
  if (mode === undefined || UNFORMATTABLE_MODES.has(mode)) continue;

  const info = await prettier.getFileInfo(file, {
    ignorePath: ".prettierignore",
  });
  if (info.ignored || info.inferredParser === null) continue;

  const staged = git(["show", `:${file}`]);
  const formatted = await prettier.format(staged, {
    ...(await prettier.resolveConfig(file)),
    filepath: file,
  });
  if (formatted === staged) continue;

  const rewriteWorkingCopy = !hasUnstagedChanges(file);
  const blob = git(
    ["hash-object", "-w", "--stdin", "--path", file],
    formatted,
  ).trim();
  git(["update-index", "--cacheinfo", `${mode},${blob},${file}`]);
  if (rewriteWorkingCopy) writeFileSync(file, formatted);
}
