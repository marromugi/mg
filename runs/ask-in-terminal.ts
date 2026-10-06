import { createInterface } from "node:readline";
import type { CredentialContext, CredentialUse } from "@mg/credentials";

// 端末なら入力の改行が画面に出ます。それ以外は出ないので、ここで改行します。
const endLine = () => {
  if (!process.stdin.isTTY) process.stdout.write("\n");
};

// 端末で使ってよいかを聞きます。y 以外は断ります。入力が閉じたときも断ります。
// 中断されたら、その理由で失敗します。
export const askInTerminal = (
  use: CredentialUse,
  context?: CredentialContext,
): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const signal = context?.signal;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const onAbort = () => {
      reject(signal?.reason);
      rl.close();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    rl.once("close", () => {
      signal?.removeEventListener("abort", onAbort);
      endLine();
      resolve(false);
    });
    rl.question(
      `Use ${use.name}.${use.field} on ${use.origin}? [y/N] `,
      (answer) => {
        resolve(answer.trim() === "y");
        rl.close();
      },
    );
  });
