import type { SecretName } from "../../../secret-store/index.js";
import { ApiKeyList } from "../../feature/ApiKeyList/index.js";
import { AppFrame } from "../../feature/AppFrame/index.js";
import { Heading, Notice } from "../../ui/index.js";

const FAILURE_LEAD = {
  read: "API キーの状態を読み込めませんでした。",
  write: "API キーを保存できませんでした。",
} as const;

export const ApiKeysPage = ({
  keys,
  problem,
  failure,
}: {
  keys: readonly { name: SecretName; isSet: boolean }[];
  problem?: { name: SecretName; message: string };
  failure?: { kind: "read" | "write"; reason: string };
}) => (
  <AppFrame current="api-keys">
    <Heading>API キー</Heading>
    {failure === undefined ? null : (
      <div className="mb-4">
        <Notice>{`${FAILURE_LEAD[failure.kind]}${failure.reason}`}</Notice>
      </div>
    )}
    <ApiKeyList keys={keys} problem={problem} />
  </AppFrame>
);
