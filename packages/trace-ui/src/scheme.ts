export type Scheme = "system" | "light" | "dark";

export const SCHEME_COOKIE = "scheme";

export const parseScheme = (value: unknown): Scheme => {
  if (value === "light" || value === "dark") {
    return value;
  }
  return "system";
};
