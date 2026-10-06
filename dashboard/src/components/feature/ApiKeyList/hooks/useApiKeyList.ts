import { useSecretLabel } from "../../../../hooks/useSecretLabel.js";
import type { SecretName } from "../../../../secret-store/index.js";

export type ApiKeyStatus = { name: SecretName; isSet: boolean };

export type ApiKeyRow = {
  name: SecretName;
  label: string;
  status: string;
  action: string;
  formAction: string;
  deleteHref: string | undefined;
  error: string | undefined;
};

export const useApiKeyList = (
  keys: readonly ApiKeyStatus[],
  problem: { name: SecretName; message: string } | undefined,
): ApiKeyRow[] =>
  keys.map(({ name, isSet }) => ({
    name,
    label: useSecretLabel(name),
    status: isSet ? "設定済み" : "未設定",
    action: isSet ? "置き換える" : "設定する",
    formAction: `/api-keys/${name}`,
    deleteHref: isSet ? `/api-keys/${name}/delete` : undefined,
    error: problem?.name === name ? problem.message : undefined,
  }));
