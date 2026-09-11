export async function* readSseData(
  body: ReadableStream<Uint8Array>,
  done = "[DONE]",
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fields: string[] = [];

  function* flush(): Generator<string, boolean> {
    if (fields.length === 0) return false;
    const payload = fields.join("\n");
    fields = [];
    if (payload === done) return true;
    yield payload;
    return false;
  }

  function* consume(raw: string): Generator<string, boolean> {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line === "") return yield* flush();
    if (line.startsWith(":")) return false;
    if (line.startsWith("data:")) {
      const value = line.slice("data:".length);
      fields.push(value.startsWith(" ") ? value.slice(1) : value);
    }
    return false;
  }

  try {
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n");
      while (index !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (yield* consume(line)) return;
        index = buffer.indexOf("\n");
      }
    }

    buffer += decoder.decode();
    if (buffer !== "" && (yield* consume(buffer))) return;
    yield* flush();
  } finally {
    reader.releaseLock();
  }
}
