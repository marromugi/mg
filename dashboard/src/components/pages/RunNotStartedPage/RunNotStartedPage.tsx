import type { SecretName } from "../../../secret-store/index.js";
import { AppFrame } from "../../feature/AppFrame/index.js";
import { Heading, Notice, TextLink } from "../../ui/index.js";

export const RunNotStartedPage = ({
  missingSecret,
  harnessHref,
}: {
  missingSecret: SecretName;
  harnessHref: string;
}) => (
  <AppFrame current="harnesses">
    <Heading>テスト実行</Heading>
    <div className="mb-4">
      <Notice>
        {`実行を始められませんでした。${missingSecret} が設定されていません。`}
      </Notice>
    </div>
    <ul className="flex flex-col gap-2">
      <li>
        <TextLink href="/api-keys">API キーのページで設定する</TextLink>
      </li>
      <li>
        <TextLink href={harnessHref}>ハーネスに戻る</TextLink>
      </li>
    </ul>
  </AppFrame>
);
