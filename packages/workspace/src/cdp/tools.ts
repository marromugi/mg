import type { Tool } from "@mg/core";
import { z } from "zod";
import type { BrowserPage } from "./browser.js";

export type BrowserToolsOptions = {
  maxOutputBytes?: number;
};

const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;

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

const truncateToBytes = (text: string, maxBytes: number): string => {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return text;
  }
  return buffer.subarray(0, maxBytes).toString("utf8");
};

export const createBrowserTools = (
  page: BrowserPage,
  options: BrowserToolsOptions = {},
): readonly Tool[] => {
  const { maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES } = options;

  const navigate: Tool<typeof navigateInput> = {
    name: "browser_navigate",
    description:
      "Navigates the browser to a URL. Returns the resulting page title " +
      "and URL as text.",
    input: navigateInput,
    async execute({ url }, context) {
      context.signal?.throwIfAborted();
      const result = await page.navigate(url);
      return `${result.title}\n${result.url}`;
    },
  };

  const read: Tool<typeof readInput> = {
    name: "browser_read",
    description:
      "Returns the current page's content as an accessibility tree of " +
      "roles and names.",
    input: readInput,
    async execute(_input, context) {
      context.signal?.throwIfAborted();
      const snapshot = await page.snapshot();
      const truncated = truncateToBytes(snapshot, maxOutputBytes);
      return truncated === snapshot
        ? snapshot
        : `${truncated}\n[output truncated]`;
    },
  };

  const click: Tool<typeof clickInput> = {
    name: "browser_click",
    description:
      "Clicks the element with the given accessibility role and name.",
    input: clickInput,
    async execute({ role, name }, context) {
      context.signal?.throwIfAborted();
      await page.click(role, name);
      return "clicked";
    },
  };

  const type: Tool<typeof typeInput> = {
    name: "browser_type",
    description:
      "Types text into the element with the given accessibility role " +
      "and name, optionally submitting with Enter.",
    input: typeInput,
    async execute({ role, name, text, submit }, context) {
      context.signal?.throwIfAborted();
      await page.type(role, name, text, submit ?? false);
      return "typed";
    },
  };

  return [navigate, read, click, type];
};
