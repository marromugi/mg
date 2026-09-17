export async function* readNdjsonLines(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let exhausted = false;

  try {
    for (;;) {
      const { value, done: finished } = await reader.read();
      exhausted ||= finished;
      buffer += finished
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = finished ? "" : (lines.pop() ?? "");
      for (const raw of lines) {
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (line !== "") yield line;
      }
      if (finished) return;
    }
  } finally {
    if (!exhausted) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
