import { AppFrame } from "../../feature/AppFrame/index.js";
import { Heading, TextLink } from "../../ui/index.js";

export const RunNotStoppedPage = ({ runHref }: { runHref: string }) => (
  <AppFrame current="harnesses">
    <Heading>テスト実行</Heading>
    <p className="mb-4">
      止められませんでした。この実行はすでに終わっているか、見つかりません。
    </p>
    <TextLink href={runHref}>実行のページへ</TextLink>
  </AppFrame>
);
