import type { BrowserPage } from "./browser.js";

// Fails every call with signal.reason once signal has aborted, before
// calling page, and in place of page's error when a call fails after.
export const failWithLoss = (
  page: BrowserPage,
  signal: AbortSignal,
): BrowserPage => {
  const guard = async <T>(call: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted();
    try {
      return await call();
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    }
  };
  return {
    navigate: (url) => guard(() => page.navigate(url)),
    snapshot: () => guard(() => page.snapshot()),
    url: () => guard(() => page.url()),
    click: (role, name) => guard(() => page.click(role, name)),
    type: (role, name, text, submit) =>
      guard(() => page.type(role, name, text, submit)),
  };
};
