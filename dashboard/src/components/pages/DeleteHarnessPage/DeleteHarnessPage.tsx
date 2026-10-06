import type { HarnessDefinition } from "../../../definition/index.js";
import { AppFrame } from "../../feature/AppFrame/index.js";
import { Button, Heading } from "../../ui/index.js";

export const DeleteHarnessPage = ({
  definition,
}: {
  definition: HarnessDefinition;
}) => (
  <AppFrame current="harnesses">
    <Heading>ハーネスを削除</Heading>
    <p className="mb-4">
      {`「${definition.name}」を削除します。削除したものは元に戻せません。`}
    </p>
    <form
      method="post"
      action={`/harnesses/${definition.id}/delete`}
      className="flex gap-3"
    >
      <Button tone="danger">削除する</Button>
      <Button href={`/harnesses/${definition.id}`}>戻る</Button>
    </form>
  </AppFrame>
);
