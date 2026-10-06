import { Heading } from "../../ui/index.js";

export const NoSessionPage = () => (
  <main className="max-w-page px-8 py-6">
    <Heading>セッションがありません</Heading>
    <p>起動時に表示されたリンクを、もう一度開いてください。</p>
  </main>
);
