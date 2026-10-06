import { useSecretLabel } from "../../../hooks/useSecretLabel.js";
import type { SecretName } from "../../../secret-store/index.js";
import { AppFrame } from "../../feature/AppFrame/index.js";
import { Button, Heading, Notice } from "../../ui/index.js";

export const DeleteApiKeyPage = ({
  name,
  failure,
}: {
  name: SecretName;
  failure?: string;
}) => (
  <AppFrame current="api-keys">
    <Heading>API キーを削除</Heading>
    {failure === undefined ? null : (
      <div className="mb-4">
        <Notice>{`削除できませんでした。${failure}`}</Notice>
      </div>
    )}
    <p className="mb-4">
      {`「${useSecretLabel(name)}」を削除します。削除したものは元に戻せません。`}
    </p>
    <form
      method="post"
      action={`/api-keys/${name}/delete`}
      className="flex gap-3"
    >
      <Button tone="danger">削除する</Button>
      <Button href="/api-keys">戻る</Button>
    </form>
  </AppFrame>
);
