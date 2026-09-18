import { chromium, type Page } from "playwright-core";
import type { ConnectorContext } from "../types.js";

export type CdpConnectorOptions = {
  url: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export interface BrowserPage {
  navigate(url: string): Promise<{ url: string; title: string }>;
  snapshot(): Promise<string>;
  click(role: string, name: string): Promise<void>;
  type(
    role: string,
    name: string,
    text: string,
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

class PlaywrightPage implements BrowserPage {
  constructor(
    private readonly page: Page,
    private readonly timeoutMs: number,
  ) {}

  async navigate(url: string): Promise<{ url: string; title: string }> {
    await this.page.goto(url, { timeout: this.timeoutMs });
    return { url: this.page.url(), title: await this.page.title() };
  }

  snapshot(): Promise<string> {
    return this.page
      .locator(":root")
      .ariaSnapshot({ timeout: this.timeoutMs });
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
    const locator = this.page.getByRole(role as Role, {
      name,
      exact: true,
    });
    await locator.fill(text, { timeout: this.timeoutMs });
    if (submit) {
      await locator.press("Enter", { timeout: this.timeoutMs });
    }
  }
}

export const connectCdp = async (
  options: CdpConnectorOptions,
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
