import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closingLine,
  createBoundedOutput,
  formatBytes,
} from "@mg/bounded-output";
import type { Tool } from "@mg/core";
import { z } from "zod";
import type { BrowserPage } from "./browser.js";

export type BrowserToolsOptions = {
  maxOutputBytes?: number;
  overflowDir?: string;
  maxSavedBytes?: number;
};

const DEFAULT_MAX_OUTPUT_BYTES = 16_384;
const DEFAULT_MAX_SAVED_BYTES = 64 * 1024 * 1024;

const navigateInput = z.object({
  url: z.string().describe("URL to navigate the browser to"),
});

const readInput = z.object({});

const clickInput = z.object({
  role: z.string().describe("Accessibility role of the element"),
  name: z.string().describe("Accessible name of the element"),
});

const typeInput = z.object({
  role: z.string().describe("Accessibility role of the element"),
  name: z.string().describe("Accessible name of the element"),
  text: z.string().describe("Text to type into the element"),
  submit: z.boolean().optional().describe("Press Enter after typing"),
});

export const createBrowserTools = (
  page: BrowserPage,
  options: BrowserToolsOptions = {},
): readonly Tool[] => {
  const {
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    overflowDir = join(tmpdir(), "mg-browser-output"),
    maxSavedBytes = DEFAULT_MAX_SAVED_BYTES,
  } = options;

  const navigate: Tool<typeof navigateInput> = {
    name: "browser_navigate",
    description:
      "Navigates the browser to a URL. Returns the resulting page title " +
      "and URL as text.",
    input: navigateInput,
    async prepare({ url }) {
      return {
        reach: { kind: "outside" },
        run: async (context) => {
          context.signal?.throwIfAborted();
          const result = await page.navigate(url);
          return `${result.title}\n${result.url}`;
        },
      };
    },
  };

  const read: Tool<typeof readInput> = {
    name: "browser_read",
    description:
      "Returns the current page's content as an accessibility tree of " +
      "roles and names. " +
      `Output over ${formatBytes(maxOutputBytes)} is cut to its start; ` +
      "the full text is saved to a file whose path is given at the end of the result.",
    input: readInput,
    async prepare(_input) {
      return {
        reach: { kind: "outside" },
        run: async (context) => {
          context.signal?.throwIfAborted();
          const snapshot = await page.snapshot();
          const output = createBoundedOutput({
            maxBytes: maxOutputBytes,
            dir: overflowDir,
            maxSavedBytes,
            keep: "start",
            onStop: () => {},
          });
          output.append(Buffer.from(snapshot, "utf8"));
          const bounded = await output.finish();

          const parts: string[] = [];
          if (bounded.text !== "") parts.push(bounded.text);
          const closing = closingLine(bounded);
          if (closing !== undefined) parts.push(closing);
          if (bounded.savedCapReached) {
            const kept = formatBytes(maxSavedBytes);
            parts.push(
              `[stopped: output passed ${kept}; the first ${kept} is saved]`,
            );
          }
          return parts.join("\n");
        },
      };
    },
  };

  const click: Tool<typeof clickInput> = {
    name: "browser_click",
    description:
      "Clicks the element with the given accessibility role and name.",
    input: clickInput,
    async prepare({ role, name }) {
      return {
        reach: { kind: "outside" },
        run: async (context) => {
          context.signal?.throwIfAborted();
          await page.click(role, name);
          return "clicked";
        },
      };
    },
  };

  const type: Tool<typeof typeInput> = {
    name: "browser_type",
    description:
      "Types text into the element with the given accessibility role " +
      "and name, optionally submitting with Enter.",
    input: typeInput,
    async prepare({ role, name, text, submit }) {
      return {
        reach: { kind: "outside" },
        run: async (context) => {
          context.signal?.throwIfAborted();
          await page.type(role, name, text, submit ?? false);
          return "typed";
        },
      };
    },
  };

  return [navigate, read, click, type];
};
