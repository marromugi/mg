import {
  chromium,
  type ElementHandle,
  type Page,
} from "playwright-core";
import type { CredentialAccess } from "@mg/credentials";
import type { ConnectorContext, Endpoint } from "../types.js";

export type CdpConnectorOptions = (
  | { url: string; endpoint?: never }
  | { endpoint: Endpoint; url?: never }
) & {
  browser: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  overflowDir?: string;
  maxSavedBytes?: number;
  credentials?: CredentialAccess;
};

export type Secret = { value: string; marker: string };

export interface BrowserPage {
  navigate(url: string): Promise<{ url: string; title: string }>;
  snapshot(): Promise<string>;
  url(): Promise<string>;
  click(role: string, name: string): Promise<void>;
  type(
    role: string,
    name: string,
    text: string,
    submit: boolean,
  ): Promise<void>;
  // Types secret.value. Until the page is replaced, snapshot() shows
  // secret.marker in the field instead of the value.
  typeSecret(
    role: string,
    name: string,
    secret: Secret,
    submit: boolean,
  ): Promise<void>;
}

export interface BrowserSession {
  page: BrowserPage;
  close(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

// playwright-core does not export the role union type on its own.
type Role = Parameters<Page["getByRole"]>[0];

type SecretField = { handle: ElementHandle; marker: string };

class PlaywrightPage implements BrowserPage {
  private secretFields: SecretField[] = [];

  constructor(
    private readonly page: Page,
    private readonly timeoutMs: number,
  ) {}

  async navigate(url: string): Promise<{ url: string; title: string }> {
    await this.page.goto(url, { timeout: this.timeoutMs });
    return { url: this.page.url(), title: await this.page.title() };
  }

  // A field the page still shows is read out of its value for the
  // snapshot and put back after. A field whose document was replaced is
  // gone with its value; any other failure to swap stops the snapshot.
  async snapshot(): Promise<string> {
    const swapped: { handle: ElementHandle; value: string }[] = [];
    const alive: SecretField[] = [];
    try {
      for (const field of this.secretFields) {
        try {
          const value = await field.handle.evaluate(
            (element, marker) => {
              const input = element as HTMLInputElement;
              const before = input.value;
              input.value = marker;
              return before;
            },
            field.marker,
          );
          swapped.push({ handle: field.handle, value });
          alive.push(field);
        } catch (error) {
          if (await this.isUsable()) continue;
          throw error;
        }
      }
      this.secretFields = alive;
      return await this.page
        .locator(":root")
        .ariaSnapshot({ timeout: this.timeoutMs });
    } finally {
      for (const { handle, value } of swapped) {
        await handle
          .evaluate((element, before) => {
            (element as HTMLInputElement).value = before;
          }, value)
          .catch(() => {});
      }
    }
  }

  private isUsable(): Promise<boolean> {
    return this.page.evaluate(() => true).catch(() => false);
  }

  async url(): Promise<string> {
    return this.page.url();
  }

  async click(role: string, name: string): Promise<void> {
    await this.page
      .getByRole(role as Role, { name, exact: true })
      .click({ timeout: this.timeoutMs });
  }

  async type(
    role: string,
    name: string,
    text: string,
    submit: boolean,
  ): Promise<void> {
    await this.fill(role, name, text, submit);
  }

  async typeSecret(
    role: string,
    name: string,
    secret: Secret,
    submit: boolean,
  ): Promise<void> {
    await this.fill(role, name, secret.value, submit, secret.marker);
  }

  private async fill(
    role: string,
    name: string,
    text: string,
    submit: boolean,
    marker?: string,
  ): Promise<void> {
    const locator = this.page.getByRole(role as Role, {
      name,
      exact: true,
    });
    await locator.fill(text, { timeout: this.timeoutMs });
    if (marker !== undefined) {
      const handle = await locator.elementHandle({
        timeout: this.timeoutMs,
      });
      if (handle !== null) this.secretFields.push({ handle, marker });
    }
    if (submit) {
      await locator.press("Enter", { timeout: this.timeoutMs });
    }
  }
}

export const connectCdp = async (
  options: { url: string; timeoutMs?: number },
  context?: ConnectorContext,
): Promise<BrowserSession> => {
  context?.signal?.throwIfAborted();

  const browser = await chromium.connectOverCDP(options.url);
  const browserContext = browser.contexts()[0];
  if (browserContext === undefined) {
    await browser.close();
    throw new Error("CDP browser has no browser context");
  }
  let page: Page;
  try {
    page =
      browserContext.pages()[0] ?? (await browserContext.newPage());
  } catch (error) {
    await browser.close();
    throw error;
  }

  return {
    page: new PlaywrightPage(
      page,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ),
    close: () => browser.close(),
  };
};
