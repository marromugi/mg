import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { Client } from "ssh2";
import { describe, expect, test } from "vitest";
import { connectSshForwarder, toSshForwarder } from "./client.js";

type Connection = Parameters<typeof toSshForwarder>[0];
type ForwardOutCallback = NonNullable<
  Parameters<Connection["forwardOut"]>[4]
>;

const connectionAnswering = (
  answer: (callback: ForwardOutCallback) => void,
): Connection => ({
  forwardOut: (_srcIP, _srcPort, _dstIP, _dstPort, callback) => {
    answer(callback as ForwardOutCallback);
    return {} as never;
  },
  end: () => ({}) as never,
  on: () => ({}) as never,
  once: () => ({}) as never,
});

describe("toSshForwarder", () => {
  test("maps a refused channel to refused, another failure to a throw, and a channel to open", async () => {
    const refusal = Object.assign(
      new Error("(SSH) Channel open failure: Connection refused"),
      { reason: 2 },
    );
    const refused = await toSshForwarder(
      connectionAnswering((callback) =>
        callback(refusal, undefined as never),
      ),
    ).forwardOut("127.0.0.1", 9333);
    expect(refused.kind).toBe("refused");
    expect(refused.kind === "refused" && refused.cause).toBe(refusal);

    const other = Object.assign(
      new Error(
        "(SSH) Channel open failure: Administratively prohibited",
      ),
      { reason: 1 },
    );
    const thrown = await toSshForwarder(
      connectionAnswering((callback) =>
        callback(other, undefined as never),
      ),
    )
      .forwardOut("127.0.0.1", 9333)
      .catch((e: unknown) => e);
    expect(thrown).toBe(other);

    const openFailed = Object.assign(
      new Error("(SSH) Channel open failure: open failed"),
      { reason: 2 },
    );
    const thrownOpenFailed = await toSshForwarder(
      connectionAnswering((callback) =>
        callback(openFailed, undefined as never),
      ),
    )
      .forwardOut("127.0.0.1", 9333)
      .catch((e: unknown) => e);
    expect(thrownOpenFailed).toBe(openFailed);

    const stream = new PassThrough();
    const opened = await toSshForwarder(
      connectionAnswering((callback) =>
        callback(undefined, stream as never),
      ),
    ).forwardOut("127.0.0.1", 9333);
    expect(opened.kind).toBe("open");
    expect(opened.kind === "open" && opened.stream).toBe(stream);
  });
});

class FakeConnection extends EventEmitter {
  endCalls = 0;
  onEnd: () => void = () => {};
  forwardOut = (): never => ({}) as never;
  end = (): never => {
    this.endCalls += 1;
    this.onEnd();
    return {} as never;
  };
}

const forwarderOver = (fake: FakeConnection) =>
  toSshForwarder(fake as unknown as Connection);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("SshForwarder.lost", () => {
  test("aborts with closed right after close is emitted", () => {
    const fake = new FakeConnection();
    const forwarder = forwarderOver(fake);
    fake.emit("close");
    expect(forwarder.lost.aborted).toBe(true);
    expect(forwarder.lost.reason).toEqual({ kind: "closed" });
  });

  test("aborts with failed and the last error when errors came before close", () => {
    const fake = new FakeConnection();
    const forwarder = forwarderOver(fake);
    const last = new Error("Keepalive timeout");
    fake.emit("error", new Error("first"));
    fake.emit("error", last);
    fake.emit("close");
    const reason = forwarder.lost.reason as {
      kind: string;
      cause: unknown;
    };
    expect(reason.kind).toBe("failed");
    expect(reason.cause).toBe(last);
  });

  test("end resolves at once after lost has aborted", async () => {
    const fake = new FakeConnection();
    const forwarder = forwarderOver(fake);
    fake.emit("close");
    const outcome = await Promise.race([
      forwarder.end().then(() => "ended"),
      sleep(50).then(() => "timer"),
    ]);
    expect(outcome).toBe("ended");
  });

  test("end on a live connection waits for close and leaves lost unaborted", async () => {
    const fake = new FakeConnection();
    fake.onEnd = () => {
      setTimeout(() => fake.emit("close"), 20);
    };
    const forwarder = forwarderOver(fake);
    let settled = false;
    const ending = forwarder.end().then(() => {
      settled = true;
    });
    await sleep(10);
    expect(settled).toBe(false);
    await ending;
    expect(fake.endCalls).toBe(1);
    expect(forwarder.lost.aborted).toBe(false);
  });
});

describe("connectSshForwarder", () => {
  test("connects with keepalive every 15000 ms and 3 misses", async () => {
    let received: Record<string, unknown> | undefined;
    const client = Object.assign(new FakeConnection(), {
      connect(config: Record<string, unknown>) {
        received = config;
        queueMicrotask(() => client.emit("ready"));
      },
    });
    await connectSshForwarder(
      {
        host: "pi-01.local",
        username: "marromugi",
        auth: { password: "secret" },
      },
      undefined,
      { createClient: () => client as unknown as Client },
    );
    expect(received).toMatchObject({
      host: "pi-01.local",
      port: 22,
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
    });
  });
});
