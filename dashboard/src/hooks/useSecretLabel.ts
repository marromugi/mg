import type { SecretName } from "../secret-store/index.js";

const LABELS: Record<SecretName, string> = {
  OPENROUTER_API_KEY: "OpenRouter API キー",
};

export const useSecretLabel = (name: SecretName): string =>
  LABELS[name];
