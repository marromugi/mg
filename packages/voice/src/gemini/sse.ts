// Gemini の streamGenerateContent が返す SSE を、data: の払い出しごとの
// 文字列に読み直します。[DONE] のような終わりの合図はなく、流れが
// 閉じたら終わります。

export async function* readGeminiSseData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fields: string[] = [];
  let exhausted = false;

  function consume(raw: string): string | undefined {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line !== "") {
      if (line.startsWith("data:")) {
        const value = line.slice("data:".length);
        fields.push(value.startsWith(" ") ? value.slice(1) : value);
      }
      return undefined;
    }
    if (fields.length === 0) return undefined;
    const payload = fields.join("\n");
    fields = [];
    return payload === "" ? undefined : payload;
  }

  try {
    for (;;) {
      const { value, done: finished } = await reader.read();
      exhausted ||= finished;
      buffer += finished
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = finished ? "" : (lines.pop() ?? "");
      if (finished) lines.push("");
      for (const line of lines) {
        const payload = consume(line);
        if (payload !== undefined) yield payload;
      }
      if (finished) return;
    }
  } finally {
    if (!exhausted) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
