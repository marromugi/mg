const REFUSALS = {
  "no-session": {
    title: "セッションがありません",
    next: "起動時に表示されたリンクを、もう一度開いてください。",
  },
  forbidden: {
    title: "受け付けられません",
    next: "アクセス元が、このダッシュボードのものではありません。起動時に表示されたリンクから開き直してください。",
  },
} as const;

export type Refusal = keyof typeof REFUSALS;

// Says why the server did not answer the request, and what to do next.
export const RefusalPage = ({ refusal }: { refusal: Refusal }) => (
  <main className="mx-auto flex max-w-page flex-col gap-2 p-6">
    <h1 className="text-heading font-semibold">
      {REFUSALS[refusal].title}
    </h1>
    <p className="text-sm">{REFUSALS[refusal].next}</p>
  </main>
);
