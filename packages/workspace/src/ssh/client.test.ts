import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import { toSshForwarder } from "./client.js";

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
