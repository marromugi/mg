import type { BrowserPage } from "./browser.js";

export type Secret = { value: string; marker: string };

export interface SecretPage extends BrowserPage {
  typeSecret(
    role: string,
    name: string,
    secret: Secret,
    submit: boolean,
  ): Promise<void>;
}

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Remembers every value typed through typeSecret for the life of the page
// and replaces it with its marker in what navigate, snapshot and failures
// give back. The URL-encoded form of a value is replaced too, because a
// form submitted by GET puts it in the address. url() is returned as it
// is: the caller compares origins with it and does not show it.
export const hideSecrets = (page: BrowserPage): SecretPage => {
  const markers = new Map<string, string>();
  let pattern: RegExp | undefined;

  const remember = ({ value, marker }: Secret): void => {
    if (value === "") return;
    markers.set(value, marker);
    markers.set(encodeURIComponent(value), marker);
    const texts = [...markers.keys()].sort(
      (a, b) => b.length - a.length,
    );
    pattern = new RegExp(texts.map(escapeRegExp).join("|"), "g");
  };

  const hide = (text: string): string =>
    pattern === undefined
      ? text
      : text.replace(pattern, (found) => markers.get(found) ?? found);

  const hideInError = (error: unknown): unknown => {
    if (!(error instanceof Error)) return error;
    const message = hide(error.message);
    const stack = hide(error.stack ?? "");
    if (message === error.message && stack === (error.stack ?? "")) {
      return error;
    }
    const hidden = new Error(message);
    hidden.name = error.name;
    hidden.stack = stack;
    return hidden;
  };

  const guard = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      throw hideInError(error);
    }
  };

  return {
    navigate: (url) =>
      guard(async () => {
        const result = await page.navigate(url);
        return { url: hide(result.url), title: hide(result.title) };
      }),
    snapshot: () => guard(async () => hide(await page.snapshot())),
    url: () => guard(() => page.url()),
    click: (role, name) => guard(() => page.click(role, name)),
    type: (role, name, text, submit) =>
      guard(() => page.type(role, name, text, submit)),
    typeSecret: (role, name, secret, submit) => {
      remember(secret);
      return guard(() => page.type(role, name, secret.value, submit));
    },
  };
};
