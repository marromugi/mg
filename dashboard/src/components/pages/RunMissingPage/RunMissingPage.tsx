import { AppFrame } from "../../feature/AppFrame/index.js";
import { Heading, TextLink } from "../../ui/index.js";

export const RunMissingPage = ({ traceDir }: { traceDir: string }) => (
  <AppFrame current="harnesses">
    <Heading>テスト実行</Heading>
    <p className="mb-2">
      この実行はもう見られません。実行の内容は、サーバーを止めると消えます。
    </p>
    <p className="mb-4">
      {"トレースは次のフォルダに残っています: "}
      <code className="font-mono">{traceDir}</code>
    </p>
    <TextLink href="/harnesses">ハーネスの一覧へ</TextLink>
  </AppFrame>
);
