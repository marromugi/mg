import type { SecretName } from "../../../secret-store/index.js";
import { Button, TextField } from "../../ui/index.js";
import { useApiKeyList } from "./hooks/useApiKeyList.js";

export const ApiKeyList = ({
  keys,
  problem,
}: {
  keys: readonly { name: SecretName; isSet: boolean }[];
  problem?: { name: SecretName; message: string };
}) => {
  const rows = useApiKeyList(keys, problem);

  return (
    <div className="flex flex-col gap-6">
      {rows.map((row) => (
        <section key={row.name} className="flex flex-col gap-3">
          <h2 className="font-semibold">
            {`${row.label}（${row.status}）`}
          </h2>
          <form
            method="post"
            action={row.formAction}
            className="flex flex-col gap-3"
          >
            <TextField
              name={row.name}
              label="キー"
              type="password"
              hint="保存したキーは、あとから表示されません。"
              error={row.error}
            />
            <div className="flex gap-3">
              <Button tone="primary">{row.action}</Button>
              {row.deleteHref === undefined ? null : (
                <Button tone="danger" href={row.deleteHref}>
                  削除
                </Button>
              )}
            </div>
          </form>
        </section>
      ))}
    </div>
  );
};
