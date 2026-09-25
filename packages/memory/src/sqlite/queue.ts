// 同じ鍵の操作を、呼ばれた順に 1 つずつ実行します。
// 前の操作の成否にかかわらず、次の操作はその後で始まります。
// 鍵の待ち行列が空になったら、その鍵をこの Map から取り除きます。
const tails = new Map<string, Promise<void>>();

export const runQueued = async <T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const previous = tails.get(key) ?? Promise.resolve();
  let markSettled: () => void;
  const settled = new Promise<void>((resolve) => {
    markSettled = resolve;
  });
  tails.set(key, settled);

  try {
    return await previous.then(operation);
  } finally {
    markSettled!();
    if (tails.get(key) === settled) {
      tails.delete(key);
    }
  }
};
