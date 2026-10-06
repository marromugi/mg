import { Heading } from "../../ui/index.js";

export const ForbiddenPage = () => (
  <main className="max-w-page px-8 py-6">
    <Heading>受け付けられません</Heading>
    <p>
      アクセス元が、このダッシュボードのものではありません。
      起動時に表示されたリンクから開き直してください。
    </p>
  </main>
);
