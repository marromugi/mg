import type { BrowserPage, Secret } from "./browser.js";

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Page text collapses runs of whitespace and drops leading and trailing
// whitespace, so a value matches with any run of whitespace in its place.
const looseSource = (text: string): string =>
  text.trim().split(/\s+/).map(escapeRegExp).join("\\s+");

// Forms of a value that page text and addresses show: as typed, escaped
// like a quoted string, percent-encoded, and encoded the way a form sent
// by GET writes it.
const formsOf = (value: string): string[] => {
  const encoded = encodeURIComponent(value);
  const quoted = JSON.stringify(value).slice(1, -1);
  const form = encoded
    .replace(/%20/g, "+")
    .replace(
      /[!'()*~]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  return [
    ...[value, quoted]
      .filter((text) => text.trim() !== "")
      .map(looseSource),
    escapeRegExp(encoded),
    escapeRegExp(form),
  ];
};

// Replaces, with its marker, every value typed through typeSecret for the
// life of the page, in what navigate, snapshot and failures give back. url()
// is returned as it is: the caller compares origins with it and does not
// show it. What a snapshot shows in a field the page still holds is
// replaced by the page itself (see BrowserPage.typeSecret).
export const hideSecrets = (page: BrowserPage): BrowserPage => {
  const secrets: { source: string; marker: string }[] = [];
  let pattern: RegExp | undefined;

  const remember = ({ value, marker }: Secret): void => {
    if (value === "") return;
    for (const source of formsOf(value)) {
      secrets.push({ source, marker });
    }
    secrets.sort((a, b) => b.source.length - a.source.length);
    pattern = new RegExp(
      secrets.map((s, i) => `(?<s${i}>${s.source})`).join("|"),
      "g",
    );
  };

  const hide = (text: string): string =>
    pattern === undefined
      ? text
      : text.replace(pattern, (...args) => {
          const groups = args[args.length - 1] as Record<
            string,
            string | undefined
          >;
          const index = secrets.findIndex(
            (_, i) => groups[`s${i}`] !== undefined,
          );
          return secrets[index]?.marker ?? "";
        });

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
      return guard(() => page.typeSecret(role, name, secret, submit));
    },
  };
};
