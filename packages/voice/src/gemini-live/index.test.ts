import { describe, expect, test, vi } from "vitest";
import type { AudioChunk } from "../audio.js";
import type {
  TranscribeOptions,
  TranscriptEvent,
} from "../transcriber.js";
import {
  createGeminiTranscriber,
  isGeminiTranscriptionError,
} from "./index.js";
import type { GeminiTranscriberOptions } from "./index.js";

type Listener = (event: unknown) => void;

class FakeSocket {
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [
      ...(this.listeners.get(type) ?? []),
      listener,
    ]);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l !== listener),
    );
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
  }

  sentJson(): unknown[] {
    return this.sent.map((message) => JSON.parse(message));
  }

  emit(type: string, event: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  open() {
    this.emit("open");
  }

  serverSend(message: unknown) {
    this.emit("message", {
      data:
        typeof message === "string" ? message : JSON.stringify(message),
    });
  }

  serverClose(code: number, reason: string) {
    this.emit("close", { code, reason });
  }

  fail() {
    this.emit("error");
    this.emit("close", { code: 1006, reason: "" });
  }
}

const fakeWebSocket = (autoOpen = true) => {
  const sockets: FakeSocket[] = [];
  const Ctor = class extends FakeSocket {
    constructor(url: string) {
      super(url);
      sockets.push(this);
      if (autoOpen) queueMicrotask(() => this.open());
    }
  };
  return { sockets, Ctor: Ctor as unknown as typeof WebSocket };
};

const audioSource = () => {
  const queue: AudioChunk[] = [];
  let waiting:
    | {
        resolve: (r: IteratorResult<AudioChunk>) => void;
        reject: (e: unknown) => void;
      }
    | undefined;
  let finished = false;
  let failure: { error: unknown } | undefined;

  const settle = () => {
    if (waiting === undefined) return;
    if (queue.length > 0) {
      const { resolve } = waiting;
      waiting = undefined;
      resolve({ done: false, value: queue.shift() as AudioChunk });
    } else if (failure !== undefined) {
      const { reject } = waiting;
      waiting = undefined;
      reject(failure.error);
    } else if (finished) {
      const { resolve } = waiting;
      waiting = undefined;
      resolve({ done: true, value: undefined });
    }
  };

  const audio: AsyncIterable<AudioChunk> = {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<AudioChunk>>((resolve, reject) => {
          waiting = { resolve, reject };
          settle();
        }),
    }),
  };
  return {
    audio,
    push: (chunk: AudioChunk) => {
      queue.push(chunk);
      settle();
    },
    end: () => {
      finished = true;
      settle();
    },
    fail: (error: unknown) => {
      failure = { error };
      settle();
    },
  };
};

const mono16k = (bytes: number[] = [1, 2, 3, 4]): AudioChunk => ({
  format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 },
  data: new Uint8Array(bytes),
});

const start = (
  options: Partial<GeminiTranscriberOptions> & {
    WebSocket: typeof WebSocket;
  },
  callOptions?: TranscribeOptions,
) => {
  const source = audioSource();
  const transcriber = createGeminiTranscriber({
    apiKey: "k",
    ...options,
  });
  const stream = transcriber.transcribe(source.audio, callOptions);
  return { source, stream, iterator: stream[Symbol.asyncIterator]() };
};

const run = (
  options: Partial<GeminiTranscriberOptions> & {
    WebSocket: typeof WebSocket;
  },
  callOptions?: TranscribeOptions,
) => {
  const { source, iterator } = start(options, callOptions);
  const events: TranscriptEvent[] = [];
  const outcome = (async () => {
    try {
      for await (const event of {
        [Symbol.asyncIterator]: () => iterator,
      }) {
        events.push(event);
      }
      return { error: undefined, failed: false };
    } catch (error) {
      return { error, failed: true };
    }
  })();
  const rejection = async () => {
    const result = await outcome;
    if (!result.failed) throw new Error("the call did not reject");
    return result.error;
  };
  return { source, events, outcome, rejection };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

// 接続が開いて setup が送られたあと、setupComplete を返します。
const acknowledgeSetup = async (socket: () => FakeSocket) => {
  await vi.waitFor(() => expect(socket().sent.length).toBe(1));
  socket().serverSend({ setupComplete: {} });
};

const interim = (text: string) => ({
  serverContent: { interimInputTranscription: { text } },
});
const completed = (text: string) => ({
  serverContent: { inputTranscription: { text } },
});
const generationComplete = {
  serverContent: { generationComplete: true },
};

describe("createGeminiTranscriber", () => {
  test("yields each in-progress transcription as a partial while audio is still being sent", async () => {
    const { sockets, Ctor } = fakeWebSocket();
    const call = run({ WebSocket: Ctor });
    call.source.push(mono16k());
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    await acknowledgeSetup(() => sockets[0]);
    await vi.waitFor(() => expect(sockets[0].sent.length).toBe(3));
    sockets[0].serverSend(interim("明日の"));
    call.source.push(mono16k());
    sockets[0].serverSend(interim("明日の 会議は"));
    call.source.push(mono16k());
    await vi.waitFor(() => expect(call.events.length).toBe(2));
    await flush();
    expect(call.events).toEqual([
      { type: "partial", text: "明日の" },
      { type: "partial", text: "明日の 会議は" },
    ]);
    call.source.end();
    sockets[0].serverSend(generationComplete);
    await call.outcome;
  });

  test("yields one final with the completed text, closes the session, and ends", async () => {
    const { sockets, Ctor } = fakeWebSocket();
    const call = run({ WebSocket: Ctor });
    call.source.push(mono16k());
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    await acknowledgeSetup(() => sockets[0]);
    call.source.end();
    sockets[0].serverSend(
      completed("明日の会議は午後 3 時に変更してください。"),
    );
    sockets[0].serverSend(generationComplete);
    const result = await call.outcome;
    expect(result.failed).toBe(false);
    expect(call.events).toEqual([
      {
        type: "final",
        text: "明日の会議は午後 3 時に変更してください。",
      },
    ]);
    expect(sockets[0].closed).toBe(true);
  });

  test("yields an empty final when generation complete arrives with no completed transcription", async () => {
    const { sockets, Ctor } = fakeWebSocket();
    const call = run({ WebSocket: Ctor });
    call.source.push(mono16k());
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    await acknowledgeSetup(() => sockets[0]);
    call.source.end();
    sockets[0].serverSend(generationComplete);
    await call.outcome;
    expect(call.events).toEqual([{ type: "final", text: "" }]);
  });

  test("rejects with a response error when a second completed transcription arrives before generation complete", async () => {
    const { sockets, Ctor } = fakeWebSocket();
    const call = run({ WebSocket: Ctor });
    call.source.push(mono16k());
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    await acknowledgeSetup(() => sockets[0]);
    call.source.end();
    sockets[0].serverSend(completed("先週送った資料を"));
    sockets[0].serverSend(completed("一度確認して"));
    sockets[0].serverSend(generationComplete);
    const error = await call.rejection();
    expect(isGeminiTranscriptionError(error)).toBe(true);
    expect((error as Error).name).toBe(
      "GeminiTranscriptionResponseError",
    );
    expect(call.events).toEqual([]);
  });

  test("yields one empty final and opens no connection when the audio ends with no chunks", async () => {
    const { sockets, Ctor } = fakeWebSocket();
    const call = run({ WebSocket: Ctor });
    call.source.end();
    await call.outcome;
    expect(call.events).toEqual([{ type: "final", text: "" }]);
    expect(sockets.length).toBe(0);
  });

  test("is named gemini and accepts only 16-bit PCM at 16000 Hz mono", () => {
    const { Ctor } = fakeWebSocket();
    const transcriber = createGeminiTranscriber({
      apiKey: "k",
      WebSocket: Ctor,
    });
    expect(transcriber.name).toBe("gemini");
    expect(transcriber.accepts).toEqual([
      { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 },
    ]);
  });

  test("rejects with a range error naming the format and opens no connection when the first chunk is in another format", async () => {
    const { sockets, Ctor } = fakeWebSocket();
    const call = run({ WebSocket: Ctor });
    call.source.push({
      format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 2 },
      data: new Uint8Array([1, 2, 3, 4]),
    });
    const error = await call.rejection();
    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toContain("2");
    expect((error as Error).message).toContain("channels");
    expect(sockets.length).toBe(0);
  });

  test("rejects with a range error naming the format and closes the session when a later chunk differs from the first", async () => {
    const { sockets, Ctor } = fakeWebSocket();
    const call = run({ WebSocket: Ctor });
    call.source.push(mono16k());
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    await acknowledgeSetup(() => sockets[0]);
    call.source.push({
      format: { encoding: "pcm-s16le", sampleRate: 24000, channels: 1 },
      data: new Uint8Array([1, 2, 3, 4]),
    });
    const error = await call.rejection();
    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toContain("24000");
    expect(sockets[0].closed).toBe(true);
  });

  test.each([["jp_JP"], [""]])(
    "rejects with a range error before connecting when the language code is %j",
    async (code) => {
      const { sockets, Ctor } = fakeWebSocket();
      const call = run({ WebSocket: Ctor }, { languages: [code] });
      call.source.push(mono16k());
      call.source.end();
      const error = await call.rejection();
      expect(error).toBeInstanceOf(RangeError);
      expect(sockets.length).toBe(0);
    },
  );

  test("sends language codes to Gemini exactly as written, and none when no languages are given", async () => {
    const withLanguages = fakeWebSocket();
    const first = run(
      { WebSocket: withLanguages.Ctor },
      { languages: ["EN-us", "ja-JP"] },
    );
    first.source.push(mono16k());
    await vi.waitFor(() =>
      expect(withLanguages.sockets.length).toBe(1),
    );
    await vi.waitFor(() =>
      expect(withLanguages.sockets[0].sent.length).toBe(1),
    );
    const setup = withLanguages.sockets[0].sentJson()[0] as {
      setup: { inputAudioTranscription: { languageCodes?: string[] } };
    };
    expect(setup.setup.inputAudioTranscription.languageCodes).toEqual([
      "EN-us",
      "ja-JP",
    ]);

    const without = fakeWebSocket();
    const second = run({ WebSocket: without.Ctor });
    second.source.push(mono16k());
    await vi.waitFor(() => expect(without.sockets.length).toBe(1));
    await vi.waitFor(() =>
      expect(without.sockets[0].sent.length).toBe(1),
    );
    const plain = without.sockets[0].sentJson()[0] as {
      setup: { inputAudioTranscription: Record<string, unknown> };
    };
    expect(plain.setup.inputAudioTranscription).toEqual({});
  });

  test("rejects with a transport error carrying the close code and reason when the session closes before generation complete", async () => {
    const { sockets, Ctor } = fakeWebSocket();
    const call = run({ WebSocket: Ctor });
    call.source.push(mono16k());
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    await acknowledgeSetup(() => sockets[0]);
    sockets[0].serverSend(interim("明日の"));
    await vi.waitFor(() => expect(call.events.length).toBe(1));
    sockets[0].serverClose(1011, "internal");
    const error = (await call.rejection()) as Error;
    expect(error.name).toBe("GeminiTranscriptionTransportError");
    expect(error.message).toContain("1011");
    expect(error.message).toContain("internal");
  });

  test("rejects with a transport error when the connection fails before it opens", async () => {
    const { sockets, Ctor } = fakeWebSocket(false);
    const call = run({ WebSocket: Ctor });
    call.source.push(mono16k());
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    sockets[0].fail();
    const error = (await call.rejection()) as Error;
    expect(error.name).toBe("GeminiTranscriptionTransportError");
  });

  test("rejects with a response error when a message is not valid JSON", async () => {
    const { sockets, Ctor } = fakeWebSocket();
    const call = run({ WebSocket: Ctor });
    call.source.push(mono16k());
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    await acknowledgeSetup(() => sockets[0]);
    sockets[0].serverSend("not json");
    const error = (await call.rejection()) as Error;
    expect(error.name).toBe("GeminiTranscriptionResponseError");
  });

  test("throws the abort reason unchanged and closes the session when aborted while waiting for the final", async () => {
    const { sockets, Ctor } = fakeWebSocket();
    const controller = new AbortController();
    const call = run(
      { WebSocket: Ctor },
      { signal: controller.signal },
    );
    call.source.push(mono16k());
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    await acknowledgeSetup(() => sockets[0]);
    call.source.end();
    await vi.waitFor(() => expect(sockets[0].sent.length).toBe(4));
    const reason = { why: "user" };
    controller.abort(reason);
    const error = await call.rejection();
    expect(error).toBe(reason);
    expect(sockets[0].closed).toBe(true);
  });

  describe("after the signal has fired", () => {
    const takePartial = async (
      sockets: FakeSocket[],
      call: ReturnType<typeof start>,
    ) => {
      const first = call.iterator.next();
      call.source.push(mono16k());
      await vi.waitFor(() => expect(sockets.length).toBe(1));
      await acknowledgeSetup(() => sockets[0]);
      sockets[0].serverSend(interim("明日の"));
      expect(await first).toEqual({
        done: false,
        value: { type: "partial", text: "明日の" },
      });
    };

    test("throws the reason before checking language codes when the signal fired before the call", async () => {
      const { sockets, Ctor } = fakeWebSocket();
      const controller = new AbortController();
      const reason = { why: "user" };
      controller.abort(reason);
      const call = start(
        { WebSocket: Ctor },
        { signal: controller.signal, languages: ["not a tag!!"] },
      );
      await expect(call.iterator.next()).rejects.toBe(reason);
      expect(sockets.length).toBe(0);
    });

    test("drops a queued final and the end, throws the reason, and closes the session", async () => {
      const { sockets, Ctor } = fakeWebSocket();
      const controller = new AbortController();
      const call = start(
        { WebSocket: Ctor },
        { signal: controller.signal },
      );
      await takePartial(sockets, call);
      sockets[0].serverSend(completed("明日の会議"));
      sockets[0].serverSend(generationComplete);
      const reason = { why: "user" };
      controller.abort(reason);
      await expect(call.iterator.next()).rejects.toBe(reason);
      expect(sockets[0].closed).toBe(true);
    });

    test("drops a queued partial and throws the reason", async () => {
      const { sockets, Ctor } = fakeWebSocket();
      const controller = new AbortController();
      const call = start(
        { WebSocket: Ctor },
        { signal: controller.signal },
      );
      await takePartial(sockets, call);
      sockets[0].serverSend(interim("明日の会議"));
      const reason = { why: "user" };
      controller.abort(reason);
      await expect(call.iterator.next()).rejects.toBe(reason);
    });

    test("throws the reason at once, yielding nothing, when stopped before any connection opened", async () => {
      const { sockets, Ctor } = fakeWebSocket();
      const controller = new AbortController();
      const call = start(
        { WebSocket: Ctor },
        { signal: controller.signal },
      );
      const pending = call.iterator.next();
      await flush();
      const reason = { why: "user" };
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
      expect(sockets.length).toBe(0);
    });

    test("throws an error queued before the stop as that error", async () => {
      const { sockets, Ctor } = fakeWebSocket();
      const controller = new AbortController();
      const call = start(
        { WebSocket: Ctor },
        { signal: controller.signal },
      );
      await takePartial(sockets, call);
      sockets[0].serverClose(1011, "internal");
      controller.abort({ why: "user" });
      const error = (await call.iterator.next().then(
        () => undefined,
        (e: unknown) => e,
      )) as Error;
      expect(error.name).toBe("GeminiTranscriptionTransportError");
      expect(error.message).toContain("1011");
    });
  });

  test("throws the audio stream's error unchanged and closes the session", async () => {
    const { sockets, Ctor } = fakeWebSocket();
    const call = run({ WebSocket: Ctor });
    call.source.push(mono16k());
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    await acknowledgeSetup(() => sockets[0]);
    await vi.waitFor(() => expect(sockets[0].sent.length).toBe(3));
    const failure = new Error("mic lost");
    call.source.fail(failure);
    const error = await call.rejection();
    expect(error).toBe(failure);
    expect(sockets[0].closed).toBe(true);
  });

  test("yields the same events when unrelated messages are interleaved", async () => {
    const { sockets, Ctor } = fakeWebSocket();
    const call = run({ WebSocket: Ctor });
    call.source.push(mono16k());
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    await acknowledgeSetup(() => sockets[0]);
    const socket = sockets[0];
    socket.serverSend({ voiceActivity: { type: "ACTIVITY_START" } });
    socket.serverSend(interim("明日の"));
    socket.serverSend({ sessionResumptionUpdate: {} });
    socket.serverSend(interim("明日の 会議は"));
    socket.serverSend({ usageMetadata: { totalTokenCount: 5 } });
    call.source.end();
    socket.serverSend({
      serverContent: { modelTurn: { parts: [{ text: "はい" }] } },
    });
    socket.serverSend(
      completed("明日の会議は午後 3 時に変更してください。"),
    );
    socket.serverSend({ goAway: { timeLeft: "1s" } });
    socket.serverSend(generationComplete);
    await call.outcome;
    expect(call.events).toEqual([
      { type: "partial", text: "明日の" },
      { type: "partial", text: "明日の 会議は" },
      {
        type: "final",
        text: "明日の会議は午後 3 時に変更してください。",
      },
    ]);
  });

  test("connects to the default endpoint with the key and sends setup, activity start, audio, and activity end in order", async () => {
    const { sockets, Ctor } = fakeWebSocket();
    const call = run({ WebSocket: Ctor });
    call.source.push(mono16k([1, 2, 3, 4]));
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    expect(sockets[0].url).toBe(
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=k",
    );
    await vi.waitFor(() => expect(sockets[0].sent.length).toBe(1));
    await flush();
    expect(sockets[0].sentJson()).toEqual([
      {
        setup: {
          model: "models/gemini-3.5-transcribe-live",
          inputAudioTranscription: {},
          realtimeInputConfig: {
            automaticActivityDetection: { disabled: true },
          },
        },
      },
    ]);
    sockets[0].serverSend({ setupComplete: {} });
    await vi.waitFor(() => expect(sockets[0].sent.length).toBe(3));
    call.source.end();
    await vi.waitFor(() => expect(sockets[0].sent.length).toBe(4));
    expect(sockets[0].sentJson().slice(1)).toEqual([
      { realtimeInput: { activityStart: {} } },
      {
        realtimeInput: {
          audio: {
            data: "AQIDBA==",
            mimeType: "audio/pcm;rate=16000",
          },
        },
      },
      { realtimeInput: { activityEnd: {} } },
    ]);
    sockets[0].serverSend(generationComplete);
    await call.outcome;
  });

  test("uses the given model name and base URL", async () => {
    const { sockets, Ctor } = fakeWebSocket();
    const call = run({
      WebSocket: Ctor,
      model: "m-x",
      baseUrl: "wss://example.test/live",
    });
    call.source.push(mono16k());
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    await vi.waitFor(() => expect(sockets[0].sent.length).toBe(1));
    expect(sockets[0].url).toBe("wss://example.test/live?key=k");
    const setup = sockets[0].sentJson()[0] as {
      setup: { model: string };
    };
    expect(setup.setup.model).toBe("models/m-x");
  });
});
