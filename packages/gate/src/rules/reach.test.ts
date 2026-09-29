import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Reach, ReachPath, ToolCall } from "@mg/core";
import { beforeAll, describe, expect, test } from "vitest";
import { GateError } from "../errors.js";
import { TOOL_CALL_KIND, type ToolCallPayload } from "../tool-gate.js";
import type { GateRequest } from "../types.js";
import { createRulesGate, type PathRule } from "./index.js";

let realDir: string;
let linkDir: string;

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), "rules-reach-"));
  const real = join(base, "real");
  mkdirSync(real);
  symlinkSync(real, join(base, "link"));
  realDir = realpathSync(real);
  linkDir = join(base, "link");
});

const request = (
  name: string,
  reach: Reach,
  args: Record<string, unknown> = {},
): GateRequest => {
  const call: ToolCall = { id: "call-1", name, arguments: args };
  const payload: ToolCallPayload = { call, reach };
  return {
    kind: TOOL_CALL_KIND,
    description: `Tool: ${name}`,
    payload,
  };
};

const paths = (...entries: ReachPath[]): Reach => ({
  kind: "paths",
  paths: entries,
});

const inside = (rel: string, extent: "file" | "tree"): ReachPath => ({
  path: join(realDir, rel),
  extent,
});

const denyEnv: PathRule[] = [
  { tools: ["read_file"], paths: ["**/.env"], allowed: false },
];

const allowDocs: PathRule[] = [
  { paths: ["docs/**"], allowed: true },
  { allowed: false, reason: "fallback" },
];

const fallback = { allowed: false, reason: "fallback" };
const noRule = { allowed: true, reason: "No rule matched." };

describe("rules gate deny rules read the declared reach", () => {
  test("denies a file inside the root that matches, following the root link and ignoring the path argument", async () => {
    const gate = createRulesGate({ root: linkDir, rules: denyEnv });

    const verdict = await gate.judge(
      request("read_file", paths(inside("sub/.env", "file")), {
        path: "ok.txt",
      }),
    );

    expect(verdict).toEqual({
      allowed: false,
      reason: "Rule 0 denied read_file on sub/.env",
    });
  });

  test("allows a file that does not match even when the path argument would", async () => {
    const gate = createRulesGate({ root: linkDir, rules: denyEnv });

    const verdict = await gate.judge(
      request("read_file", paths(inside("src/a.ts", "file")), {
        path: ".env",
      }),
    );

    expect(verdict).toEqual(noRule);
  });

  test("denies a tree when something below it could match", async () => {
    const gate = createRulesGate({
      root: linkDir,
      rules: [{ paths: ["**/.env"], allowed: false }],
    });

    const atRoot = await gate.judge(
      request("grep", paths(inside(".", "tree"))),
    );
    const atSrc = await gate.judge(
      request("grep", paths(inside("src", "tree"))),
    );

    expect(atRoot).toEqual({
      allowed: false,
      reason: "Rule 0 denied grep on .",
    });
    expect(atSrc).toEqual({
      allowed: false,
      reason: "Rule 0 denied grep on src",
    });
  });

  test("denies a tree only where the glob can reach below it", async () => {
    const gate = createRulesGate({
      root: linkDir,
      rules: [{ paths: [".git/**"], allowed: false }],
    });

    const atGit = await gate.judge(
      request("grep", paths(inside(".git", "tree"))),
    );
    const atSrc = await gate.judge(
      request("grep", paths(inside("src", "tree"))),
    );

    expect(atGit).toEqual({
      allowed: false,
      reason: "Rule 0 denied grep on .git",
    });
    expect(atSrc).toEqual(noRule);
  });

  test("denies when any one of several declared paths matches", async () => {
    const gate = createRulesGate({ root: linkDir, rules: denyEnv });

    const verdict = await gate.judge(
      request(
        "read_file",
        paths(inside("a.txt", "file"), inside("sub/.env", "file")),
      ),
    );

    expect(verdict.reason).toBe("Rule 0 denied read_file on sub/.env");
  });

  test("denies a path outside the root for either extent", async () => {
    const gate = createRulesGate({ root: linkDir, rules: denyEnv });
    const withReason = createRulesGate({
      root: linkDir,
      rules: [{ ...denyEnv[0], reason: "no" }],
    });

    const file = await gate.judge(
      request(
        "read_file",
        paths({ path: "/etc/hosts", extent: "file" }),
      ),
    );
    const tree = await gate.judge(
      request("read_file", paths({ path: "/etc", extent: "tree" })),
    );
    const custom = await withReason.judge(
      request(
        "read_file",
        paths({ path: "/etc/hosts", extent: "file" }),
      ),
    );

    expect(file.reason).toBe(
      "Rule 0 denied read_file on /etc/hosts (outside the root)",
    );
    expect(tree.reason).toBe(
      "Rule 0 denied read_file on /etc (outside the root)",
    );
    expect(custom.reason).toBe("no");
  });

  test("denies a call that reaches anywhere local, saying the paths could not be decided", async () => {
    const gate = createRulesGate({
      root: linkDir,
      rules: [{ tools: ["bash"], paths: ["**/.env"], allowed: false }],
    });

    const verdict = await gate.judge(
      request("bash", { kind: "any-local" }),
    );

    expect(verdict.reason).toBe(
      "Rule 0 denied bash: the paths it touches could not be decided.",
    );
  });

  test("puts the rule's own reason after the undecided sentence", async () => {
    const gate = createRulesGate({
      root: linkDir,
      rules: [
        {
          tools: ["bash"],
          paths: ["**/.env"],
          allowed: false,
          reason: "Secrets are off limits.",
        },
      ],
    });

    const verdict = await gate.judge(
      request("bash", { kind: "any-local" }),
    );

    expect(verdict.reason).toBe(
      "Rule 0 denied bash: the paths it touches could not be decided. Secrets are off limits.",
    );
  });

  test("does not apply a paths rule to an outside or none reach", async () => {
    const gate = createRulesGate({
      root: linkDir,
      rules: [{ paths: ["**"], allowed: false }],
    });

    const outside = await gate.judge(
      request("web_search", { kind: "outside" }),
    );
    const none = await gate.judge(request("helper", { kind: "none" }));

    expect(outside).toEqual(noRule);
    expect(none).toEqual(noRule);
  });

  test("still applies a tools-only rule to an outside reach", async () => {
    const gate = createRulesGate({
      root: linkDir,
      rules: [{ tools: ["web_search"], allowed: false }],
    });

    const verdict = await gate.judge(
      request("web_search", { kind: "outside" }),
    );

    expect(verdict).toEqual({
      allowed: false,
      reason: "Rule 0 denied web_search",
    });
  });

  test("does not apply a deny paths rule to an empty list of paths", async () => {
    const gate = createRulesGate({
      root: linkDir,
      rules: [{ paths: ["**"], allowed: false }],
    });

    const verdict = await gate.judge(
      request("read_file", { kind: "paths", paths: [] }),
    );

    expect(verdict).toEqual(noRule);
  });
});

describe("rules gate payload and root failures", () => {
  test("rejects a payload without a reach", async () => {
    const gate = createRulesGate({ root: linkDir, rules: [] });

    const error = await gate
      .judge({
        kind: TOOL_CALL_KIND,
        description: "no reach",
        payload: { call: { id: "1", name: "bash", arguments: {} } },
      })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(GateError);
    expect((error as Error).message).toBe(
      "Rules gate payload is missing reach",
    );
  });

  test("throws when the root cannot be resolved", async () => {
    const missing = join(realDir, "gone");
    const gate = createRulesGate({ root: missing, rules: denyEnv });

    const error = await gate
      .judge(request("read_file", paths(inside("sub/.env", "file"))))
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(GateError);
    expect((error as Error).message).toBe(
      `cannot resolve the rules gate root: ${missing}`,
    );
  });
});

describe("rules gate allow rules match only what is certainly covered", () => {
  test("allows a file inside the root that matches", async () => {
    const gate = createRulesGate({ root: linkDir, rules: allowDocs });

    const verdict = await gate.judge(
      request("read_file", paths(inside("docs/a.md", "file"))),
    );

    expect(verdict).toEqual({
      allowed: true,
      reason: "Rule 0 allowed read_file on docs/a.md",
    });
  });

  test("falls through when a declared path is a tree", async () => {
    const gate = createRulesGate({ root: linkDir, rules: allowDocs });

    const docs = await gate.judge(
      request("grep", paths(inside("docs", "tree"))),
    );
    const all = await gate.judge(
      request("grep", paths(inside(".", "tree"))),
    );
    const mixed = await gate.judge(
      request(
        "grep",
        paths(inside("docs/a.md", "file"), inside("docs", "tree")),
      ),
    );

    expect(docs).toEqual(fallback);
    expect(all).toEqual(fallback);
    expect(mixed).toEqual(fallback);
  });

  test("falls through for a call that reaches anywhere local", async () => {
    const gate = createRulesGate({ root: linkDir, rules: allowDocs });

    const verdict = await gate.judge(
      request("bash", { kind: "any-local" }),
    );

    expect(verdict).toEqual(fallback);
  });

  test("falls through when a declared path is outside the root", async () => {
    const gate = createRulesGate({ root: linkDir, rules: allowDocs });

    const alone = await gate.judge(
      request(
        "read_file",
        paths({ path: "/etc/hosts", extent: "file" }),
      ),
    );
    const mixed = await gate.judge(
      request(
        "read_file",
        paths(inside("docs/a.md", "file"), {
          path: "/etc/hosts",
          extent: "file",
        }),
      ),
    );

    expect(alone).toEqual(fallback);
    expect(mixed).toEqual(fallback);
  });

  test("falls through for an empty list of paths", async () => {
    const gate = createRulesGate({ root: linkDir, rules: allowDocs });

    const verdict = await gate.judge(
      request("read_file", { kind: "paths", paths: [] }),
    );

    expect(verdict).toEqual(fallback);
  });

  test("falls through when one of several files matches no glob", async () => {
    const gate = createRulesGate({ root: linkDir, rules: allowDocs });

    const verdict = await gate.judge(
      request(
        "read_file",
        paths(inside("docs/a.md", "file"), inside("src/a.ts", "file")),
      ),
    );

    expect(verdict).toEqual(fallback);
  });

  test("allows when each file matches some glob of the rule", async () => {
    const gate = createRulesGate({
      root: linkDir,
      rules: [
        { paths: ["docs/**", "src/**"], allowed: true },
        { allowed: false, reason: "fallback" },
      ],
    });

    const verdict = await gate.judge(
      request(
        "read_file",
        paths(inside("docs/a.md", "file"), inside("src/a.ts", "file")),
      ),
    );

    expect(verdict).toEqual({
      allowed: true,
      reason: "Rule 0 allowed read_file on docs/a.md",
    });
  });
});

describe("createRulesGate glob validation", () => {
  const unsplittable = [
    "{docs/a,src}.md",
    "+(docs/a|src).md",
    "/docs/**",
    "./docs/**",
    "docs/",
    "docs//a.md",
    "docs/\\*.md",
  ];

  test.each(unsplittable)(
    "refuses the glob %s when the gate is created",
    (glob) => {
      expect(() =>
        createRulesGate({
          root: "/repo",
          rules: [{ paths: [glob], allowed: false }],
        }),
      ).toThrow(
        new RangeError(
          `rules gate glob cannot be split into segments: ${glob}`,
        ),
      );
    },
  );

  test("refuses an unsplittable glob in an allow rule", () => {
    expect(() =>
      createRulesGate({
        root: "/repo",
        rules: [{ paths: ["/docs/**"], allowed: true }],
      }),
    ).toThrow(
      new RangeError(
        "rules gate glob cannot be split into segments: /docs/**",
      ),
    );
  });

  test("names the first unsplittable glob in rule then glob order", () => {
    expect(() =>
      createRulesGate({
        root: "/repo",
        rules: [
          { paths: ["docs/**", "/a"], allowed: true },
          { paths: ["b/"], allowed: false },
        ],
      }),
    ).toThrow(
      new RangeError(
        "rules gate glob cannot be split into segments: /a",
      ),
    );
  });

  test("accepts braces without a slash, and slashes outside groups", () => {
    expect(() =>
      createRulesGate({
        root: "/repo",
        rules: [
          {
            paths: ["**/{a,b}.env", ".git/**", "{a,b}/*.md"],
            allowed: false,
          },
        ],
      }),
    ).not.toThrow();
  });
});
