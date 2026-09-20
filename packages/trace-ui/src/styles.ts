import { readFileSync } from "node:fs";

export const readStyles = (
  location: URL,
  warn: (line: string) => void,
): string => {
  try {
    return readFileSync(location, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    warn("trace-ui: dist/styles.css not found; run `pnpm build`");
    return "";
  }
};

export const styles: string = readStyles(
  new URL("../dist/styles.css", import.meta.url),
  console.warn,
);
