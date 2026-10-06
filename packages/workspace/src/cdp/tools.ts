import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closingLine,
  createBoundedOutput,
  formatBytes,
} from "@mg/bounded-output";
import type { Tool } from "@mg/core";
import type { CredentialAccess } from "@mg/credentials";
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

const credentialsInput = z.object({});

const fillCredentialInput = z.object({
  role: z.string().describe("Accessibility role of the element"),
  name: z.string().describe("Accessible name of the element"),
  credential: z.string().describe("Name of the saved login"),
  field: z
    .string()
    .describe("Field of the saved login, such as password"),
  submit: z.boolean().optional().describe("Press Enter after filling"),
});

// The origin of the page the browser is on now. Only the top page counts.
const currentOrigin = async (page: BrowserPage): Promise<string> => {
  const url = await page.url();
  let origin: string | undefined;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = undefined;
  }
  if (origin === undefined || origin === "null") {
    throw new Error(
      "the current page has no origin (it is not an http or https page), " +
        "so no saved login can be used on it",
    );
  }
  return origin;
};

export const createCredentialTools = (
  page: BrowserPage,
  access: CredentialAccess,
): readonly Tool[] => {
  const credentials: Tool<typeof credentialsInput> = {
    name: "browser_credentials",
    description:
      "Lists the saved logins that can be used on the current page, " +
      "with the fields of each. Values are never shown.",
    input: credentialsInput,
    async prepare(_input) {
      return {
        reach: { kind: "outside" },
        run: async (context) => {
          context.signal?.throwIfAborted();
          const origin = await currentOrigin(page);
          const usable = access.usableAt(origin);
          if (usable.length === 0) {
            return `no saved logins can be used at ${origin}`;
          }
          return usable
            .map((entry) => `${entry.name}: ${entry.fields.join(", ")}`)
            .join("\n");
        },
      };
    },
  };

  const fill: Tool<typeof fillCredentialInput> = {
    name: "browser_fill_credential",
    description:
      "Fills the element with the given accessibility role and name " +
      "with one field of a saved login, optionally submitting with " +
      "Enter. The value goes into the page without being shown, and " +
      "page text shows [credential <name>.<field>] where it appears. " +
      "Only works on the sites the login is registered for.",
    input: fillCredentialInput,
    async prepare({ role, name, credential, field, submit }) {
      return {
        reach: { kind: "outside" },
        run: async (context) => {
          context.signal?.throwIfAborted();
          const origin = await currentOrigin(page);
          const value = await access.use(
            { name: credential, field, origin },
            { signal: context.signal },
          );
          const now = await currentOrigin(page);
          if (now !== origin) {
            throw new Error(
              `the page moved from ${origin} to ${now} while ${credential}.${field} was being approved, so nothing was typed`,
            );
          }
          await page.typeSecret(
            role,
            name,
            { value, marker: `[credential ${credential}.${field}]` },
            submit ?? false,
          );
          return `filled ${credential}.${field}`;
        },
      };
    },
  };

  return [credentials, fill];
};
