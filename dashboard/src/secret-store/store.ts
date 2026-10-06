export const SECRET_NAMES = ["OPENROUTER_API_KEY"] as const;

export type SecretName = (typeof SECRET_NAMES)[number];

export const isSecretName = (value: string): value is SecretName =>
  (SECRET_NAMES as readonly string[]).includes(value);

// Keeps a secret under a name and gives it back to the server's own
// code. Nothing here is meant to reach a page or a log.
export interface SecretStore {
  has(name: SecretName): Promise<boolean>;
  // Undefined when no secret is kept under this name.
  get(name: SecretName): Promise<string | undefined>;
  // Replaces the secret when one is already kept.
  set(name: SecretName, value: string): Promise<void>;
  // Deleting a name that is not kept succeeds.
  delete(name: SecretName): Promise<void>;
}
