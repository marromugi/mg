import { createInterface } from "node:readline";
import type { CredentialContext, CredentialUse } from "@mg/credentials";

// 端末で使ってよいかを聞きます。y 以外は断ります。入力が閉じたときも断ります。
export const askInTerminal = (
  use: CredentialUse,
  context?: CredentialContext,
): Promise<boolean> =>
  new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.once("close", () => resolve(false));
    rl.question(
      `Use ${use.name}.${use.field} on ${use.origin}? [y/N] `,
      { signal: context?.signal },
      (answer) => {
        resolve(answer.trim() === "y");
        rl.close();
      },
    );
  });
