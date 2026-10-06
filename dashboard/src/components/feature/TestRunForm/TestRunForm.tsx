import { Button, TextArea } from "../../ui/index.js";

export const TestRunForm = ({
  action,
  problem,
}: {
  action: string;
  problem?: string;
}) => (
  <section className="mt-8 flex flex-col gap-3">
    <h2 className="text-heading font-bold">テスト実行</h2>
    <form method="post" action={action} className="flex flex-col gap-3">
      <TextArea
        name="input"
        label="入力"
        hint="保存したハーネスで実行します。上のフォームで編集中の内容は使われません。"
        error={problem}
      />
      <div>
        <Button tone="primary">実行する</Button>
      </div>
    </form>
  </section>
);
