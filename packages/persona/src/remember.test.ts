import type {
  Estimate,
  EstimateOptions,
  EstimateRequest,
  Estimator,
  Message,
  Score,
} from "@mg/core";
import {
  MemoryConflictError,
  MemoryItemNotFoundError,
} from "@mg/memory";
import type {
  MemoryChange,
  MemoryItem,
  MemoryStore,
  MissCounts,
} from "@mg/memory";
import { ATTR, SPAN } from "@mg/trace";
import { describe, expect, test, vi } from "vitest";
import { ExtractorContractError } from "./errors.js";
import type { RecallRead } from "./read.js";
import { createRemember, type RememberOptions } from "./remember.js";
import { RecordingSpan } from "./recording-span.test-helper.js";
import type {
  Counterpart,
  Extraction,
  Extractor,
  ExtractorInput,
  PersonaContext,
  RememberOutcome,
  RememberRequest,
} from "./types.js";

const asUpdated = (
  outcome: RememberOutcome<RecallRead>,
): Extract<RememberOutcome<RecallRead>, { updated: true }> => {
  if (!outcome.updated) {
    throw new Error("expected an updated outcome");
  }
  return outcome;
};

const asUndecided = (
  outcome: RememberOutcome<RecallRead>,
): Extract<RememberOutcome<RecallRead>, { reason: "undecided" }> => {
  if (outcome.updated || outcome.reason !== "undecided") {
    throw new Error("expected an undecided outcome");
  }
  return outcome;
};

const createFakeExtractor = (
  extract: (input: ExtractorInput) => Promise<Extraction>,
): Extractor & {
  extractCalls: Array<[ExtractorInput, PersonaContext | undefined]>;
} => {
  const extractCalls: Array<
    [ExtractorInput, PersonaContext | undefined]
  > = [];
  return {
    extractCalls,
    extract: (input, context) => {
      extractCalls.push([input, context]);
      return extract(input);
    },
  };
};

const createFakeEstimator = (
  estimate: (request: EstimateRequest) => Promise<Estimate>,
): Estimator & {
  estimateCalls: Array<[EstimateRequest, EstimateOptions | undefined]>;
} => {
  const estimateCalls: Array<
    [EstimateRequest, EstimateOptions | undefined]
  > = [];
  return {
    model: "estimator-1",
    limits: { maxLabels: 4, maxLevels: 10 },
    estimateCalls,
    estimate: (request, options) => {
      estimateCalls.push([request, options]);
      return estimate(request);
    },
    classify: () => Promise.reject(new Error("not used")),
    score: (): Promise<Score> => Promise.reject(new Error("not used")),
  };
};

const estimateBySubjectKind =
  (keepProbability: number, personaProbability = 0) =>
  (request: EstimateRequest): Promise<Estimate> => {
    const subject = request.subject as Record<string, unknown>;
    if ("counterpart" in subject) {
      return Promise.resolve({ probability: keepProbability });
    }
    return Promise.resolve({ probability: personaProbability });
  };

const createFakeStore = (
  write: (
    personaId: string,
    change: MemoryChange,
  ) => Promise<MissCounts>,
  del: (
    personaId: string,
    itemIds: readonly string[],
  ) => Promise<void> = () => Promise.resolve(),
): MemoryStore & {
  writeCalls: Array<[string, MemoryChange]>;
  deleteCalls: Array<[string, readonly string[]]>;
} => {
  const writeCalls: Array<[string, MemoryChange]> = [];
  const deleteCalls: Array<[string, readonly string[]]> = [];
  return {
    writeCalls,
    deleteCalls,
    create: () => Promise.reject(new Error("not used")),
    read: () => Promise.reject(new Error("not used")),
    write: (personaId, change) => {
      writeCalls.push([personaId, change]);
      return write(personaId, change);
    },
    delete: (personaId, itemIds) => {
      deleteCalls.push([personaId, itemIds]);
      return del(personaId, itemIds);
    },
  };
};

const createSequentialId = (...ids: string[]): (() => string) => {
  let index = 0;
  return () => {
    const nextId = ids[index];
    index += 1;
    if (nextId === undefined) {
      throw new Error("no more ids");
    }
    return nextId;
  };
};

const counterparts: Counterpart[] = [
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" },
];
const conversation = "t1";
const personaDoc = { text: "I am Jev.", version: 1 };
const summaryDoc = { text: "we met", version: 2 };

const itemA: MemoryItem = {
  id: "m1",
  counterpart: "alice",
  text: "likes cats",
  createdAt: 300,
  misses: 0,
};
const itemB: MemoryItem = {
  id: "m2",
  counterpart: "alice",
  text: "lives in Kyoto",
  createdAt: 200,
  misses: 2,
};
const itemC: MemoryItem = {
  id: "m3",
  counterpart: "bob",
  text: "plays go",
  createdAt: 100,
  misses: 0,
};
const itemD: MemoryItem = {
  id: "m4",
  counterpart: "bob",
  text: "hates rain",
  createdAt: 50,
  misses: 0,
};

const entry: Message[] = [
  { role: "system", content: "I am Jev." },
  { role: "user", content: "alice: I got a dog" },
  { role: "assistant", parts: [{ type: "text", text: "Nice!" }] },
];

const transcriptText =
  "[system]\nI am Jev.\n\n[user]\nalice: I got a dog\n\n[assistant]\nNice!";

const baseRead: RecallRead = {
  counterparts,
  conversation,
  persona: personaDoc,
  summary: summaryDoc,
  items: [itemA, itemB, itemC, itemD],
  candidates: ["m1", "m2", "m3"],
  selected: ["m1"],
};

const createOptions = (params: {
  store: MemoryStore;
  estimator: Estimator;
  extractor: Extractor;
  forgetting?: { missLimit: number; itemsPerCounterpart: number };
  now?: () => number;
  newId?: () => string;
}): RememberOptions => ({
  id: "jev",
  store: params.store,
  estimator: params.estimator,
  extractor: params.extractor,
  keep: { question: "Keep?", threshold: 0.6 },
  persona: { question: "Accept?", threshold: 0.8 },
  forgetting: params.forgetting ?? {
    missLimit: 3,
    itemsPerCounterpart: 3,
  },
  now: params.now ?? (() => 400),
  newId: params.newId ?? createSequentialId("n1", "n2"),
});

const extractorReturning = (
  extraction: Extraction,
): Extractor & {
  extractCalls: Array<[ExtractorInput, PersonaContext | undefined]>;
} => createFakeExtractor(() => Promise.resolve(extraction));

describe("remember", () => {
  test("calls the extractor with the counterparts, entry and current memory, passing the context signal through", async () => {
    const extractor = extractorReturning({
      summary: "we met; alice got a dog",
      items: [{ counterpart: "alice", text: "has a dog" }],
    });
    const estimator = createFakeEstimator(estimateBySubjectKind(0));
    const store = createFakeStore(() => Promise.resolve({}));
    const remember = createRemember(
      createOptions({ store, estimator, extractor }),
    );
    const controller = new AbortController();

    await remember(
      { read: baseRead, entry },
      { signal: controller.signal },
    );

    expect(extractor.extractCalls[0]?.[0]).toEqual({
      counterparts,
      entry,
      memory: {
        persona: "I am Jev.",
        items: [
          { counterpart: "alice", text: "likes cats" },
          { counterpart: "alice", text: "lives in Kyoto" },
          { counterpart: "bob", text: "plays go" },
          { counterpart: "bob", text: "hates rain" },
        ],
        summary: "we met",
      },
    });
    expect(extractor.extractCalls[0]?.[1]?.signal).toBe(
      controller.signal,
    );
  });

  test("keeps a candidate scored at or above the keep threshold, writes it and forgets the item past the miss limit", async () => {
    const extractor = extractorReturning({
      summary: "we met; alice got a dog",
      items: [{ counterpart: "alice", text: "has a dog" }],
    });
    const estimator = createFakeEstimator(estimateBySubjectKind(0.9));
    const store = createFakeStore(() =>
      Promise.resolve({ m2: 3, m3: 1 }),
    );
    const remember = createRemember(
      createOptions({ store, estimator, extractor }),
    );
    const controller = new AbortController();

    const outcome = await remember(
      { read: baseRead, entry },
      { signal: controller.signal },
    );

    expect(estimator.estimateCalls).toHaveLength(1);
    expect(estimator.estimateCalls[0]?.[0]).toEqual({
      subject: { counterpart: "alice", text: "has a dog" },
      question: "Keep?",
    });
    expect(estimator.estimateCalls[0]?.[1]?.signal).toBe(
      controller.signal,
    );
    expect(store.writeCalls[0]).toEqual([
      "jev",
      {
        summary: {
          conversation: "t1",
          text: "we met; alice got a dog",
          expectedVersion: 2,
        },
        add: [
          {
            id: "n1",
            counterpart: "alice",
            text: "has a dog",
            createdAt: 400,
          },
        ],
        hits: ["m1"],
        misses: ["m2", "m3"],
      },
    ]);
    expect(store.deleteCalls).toEqual([["jev", ["m2"]]]);
    expect(outcome).toEqual({
      updated: true,
      added: ["n1"],
      personaChanged: false,
      forgotten: ["m2"],
    });
  });

  test("adds nothing and does not call the id-making function when the candidate scores below the keep threshold", async () => {
    const extractor = extractorReturning({
      summary: "we met; alice got a dog",
      items: [{ counterpart: "alice", text: "has a dog" }],
    });
    const estimator = createFakeEstimator(estimateBySubjectKind(0.5));
    const store = createFakeStore(() => Promise.resolve({}));
    const newId = vi.fn(createSequentialId("n1"));
    const remember = createRemember(
      createOptions({ store, estimator, extractor, newId }),
    );

    const outcome = await remember({ read: baseRead, entry });

    const change = store.writeCalls[0]?.[1];
    expect(change?.add).toBeUndefined();
    expect(change?.hits).toEqual(["m1"]);
    expect(change?.misses).toEqual(["m2", "m3"]);
    expect(change?.summary).toEqual({
      conversation: "t1",
      text: "we met; alice got a dog",
      expectedVersion: 2,
    });
    expect(outcome).toMatchObject({ updated: true, added: [] });
    expect(newId).not.toHaveBeenCalled();
  });

  test("accepts a persona rewrite scored at or above the persona threshold, judged against the transcript", async () => {
    const extractor = extractorReturning({
      summary: "we met; alice got a dog",
      items: [{ counterpart: "alice", text: "has a dog" }],
      persona: "I am Jev, a dog person.",
    });
    const estimator = createFakeEstimator(
      estimateBySubjectKind(0.9, 0.9),
    );
    const store = createFakeStore(() => Promise.resolve({}));
    const controller = new AbortController();
    const remember = createRemember(
      createOptions({ store, estimator, extractor }),
    );

    const outcome = await remember(
      { read: baseRead, entry },
      { signal: controller.signal },
    );

    expect(estimator.estimateCalls[1]?.[0]).toEqual({
      subject: {
        previous: "I am Jev.",
        proposed: "I am Jev, a dog person.",
        conversation: transcriptText,
      },
      question: "Accept?",
    });
    expect(estimator.estimateCalls[1]?.[1]?.signal).toBe(
      controller.signal,
    );
    expect(store.writeCalls[0]?.[1].persona).toEqual({
      text: "I am Jev, a dog person.",
      expectedVersion: 1,
    });
    expect(outcome).toMatchObject({ personaChanged: true });
  });

  test("rejects a persona rewrite scored below the persona threshold", async () => {
    const extractor = extractorReturning({
      summary: "we met; alice got a dog",
      items: [{ counterpart: "alice", text: "has a dog" }],
      persona: "I am Jev, a dog person.",
    });
    const estimator = createFakeEstimator(
      estimateBySubjectKind(0.9, 0.7),
    );
    const store = createFakeStore(() => Promise.resolve({}));
    const remember = createRemember(
      createOptions({ store, estimator, extractor }),
    );

    const outcome = await remember({ read: baseRead, entry });

    expect(store.writeCalls[0]?.[1].persona).toBeUndefined();
    expect(outcome).toMatchObject({ personaChanged: false });
  });

  test("forgets an item past a lower per-counterpart limit, but keeps it when the base limit is not exceeded", async () => {
    const extractor = extractorReturning({
      summary: "we met; alice got a dog",
      items: [{ counterpart: "alice", text: "has a dog" }],
    });
    const estimator = createFakeEstimator(estimateBySubjectKind(0.9));

    const narrowStore = createFakeStore(() =>
      Promise.resolve({ m2: 1, m3: 1 }),
    );
    const narrowRemember = createRemember(
      createOptions({
        store: narrowStore,
        estimator,
        extractor,
        forgetting: { missLimit: 3, itemsPerCounterpart: 2 },
      }),
    );
    const narrowOutcome = await narrowRemember({
      read: baseRead,
      entry,
    });
    expect(narrowStore.deleteCalls).toEqual([["jev", ["m2"]]]);
    expect(narrowOutcome).toMatchObject({ forgotten: ["m2"] });

    const baseStore = createFakeStore(() =>
      Promise.resolve({ m2: 1, m3: 1 }),
    );
    const baseRemember = createRemember(
      createOptions({ store: baseStore, estimator, extractor }),
    );
    const outcome = await baseRemember({ read: baseRead, entry });
    expect(baseStore.deleteCalls).toEqual([]);
    expect(outcome).toMatchObject({ forgotten: [] });
  });

  test("forgets an item that is over both the per-counterpart limit and the miss limit only once", async () => {
    const extractor = extractorReturning({
      summary: "we met; alice got a dog",
      items: [{ counterpart: "alice", text: "has a dog" }],
    });
    const estimator = createFakeEstimator(estimateBySubjectKind(0.9));
    const store = createFakeStore(() =>
      Promise.resolve({ m2: 3, m3: 1 }),
    );
    const remember = createRemember(
      createOptions({
        store,
        estimator,
        extractor,
        forgetting: { missLimit: 3, itemsPerCounterpart: 2 },
      }),
    );

    const outcome = await remember({ read: baseRead, entry });

    expect(store.deleteCalls).toEqual([["jev", ["m2"]]]);
    expect(outcome).toMatchObject({ forgotten: ["m2"] });
  });

  test("writes summary expectedVersion 0 when the read has no summary of its own", async () => {
    const { summary: _summary, ...readWithoutSummary } = baseRead;
    const extractor = extractorReturning({
      summary: "we met; alice got a dog",
      items: [{ counterpart: "alice", text: "has a dog" }],
    });
    const estimator = createFakeEstimator(estimateBySubjectKind(0.9));
    const store = createFakeStore(() => Promise.resolve({}));
    const remember = createRemember(
      createOptions({ store, estimator, extractor }),
    );

    await remember({ read: readWithoutSummary, entry });

    expect(store.writeCalls[0]?.[1].summary).toEqual({
      conversation: "t1",
      text: "we met; alice got a dog",
      expectedVersion: 0,
    });
  });

  test("adds candidates in extraction order and forgets everything past a per-counterpart limit of one, across both counterparts", async () => {
    const extractor = extractorReturning({
      summary: "we met; alice got a dog",
      items: [
        { counterpart: "alice", text: "has a dog" },
        { counterpart: "alice", text: "named Pochi" },
      ],
    });
    const estimator = createFakeEstimator(estimateBySubjectKind(0.9));
    const store = createFakeStore(() =>
      Promise.resolve({ m2: 1, m3: 1 }),
    );
    const remember = createRemember(
      createOptions({
        store,
        estimator,
        extractor,
        forgetting: { missLimit: 3, itemsPerCounterpart: 1 },
      }),
    );

    const outcome = await remember({ read: baseRead, entry });

    expect(store.writeCalls[0]?.[1].add).toEqual([
      {
        id: "n1",
        counterpart: "alice",
        text: "has a dog",
        createdAt: 400,
      },
      {
        id: "n2",
        counterpart: "alice",
        text: "named Pochi",
        createdAt: 400,
      },
    ]);
    expect(store.deleteCalls).toHaveLength(1);
    expect(new Set(store.deleteCalls[0]?.[1])).toEqual(
      new Set(["n1", "m1", "m2", "m4"]),
    );
    expect(new Set(asUpdated(outcome).forgotten)).toEqual(
      new Set(["n1", "m1", "m2", "m4"]),
    );
  });

  describe("contract violations from the extractor", () => {
    test("returns undecided with an unknown-counterpart error and does not write", async () => {
      const extractor = extractorReturning({
        summary: "s",
        items: [{ counterpart: "carol", text: "x" }],
      });
      const estimator = createFakeEstimator(estimateBySubjectKind(0.9));
      const store = createFakeStore(() => Promise.resolve({}));
      const remember = createRemember(
        createOptions({ store, estimator, extractor }),
      );
      const request: RememberRequest<RecallRead> = {
        read: baseRead,
        entry,
      };

      const outcome = await remember(request);
      const undecided = asUndecided(outcome);

      expect(undecided.error).toBeInstanceOf(ExtractorContractError);
      expect((undecided.error as ExtractorContractError).kind).toBe(
        "unknown-counterpart",
      );
      expect(undecided.request).toBe(request);
      expect(store.writeCalls).toHaveLength(0);
    });

    test("returns undecided with an empty-text error and does not write", async () => {
      const extractor = extractorReturning({
        summary: "s",
        items: [{ counterpart: "alice", text: " " }],
      });
      const estimator = createFakeEstimator(estimateBySubjectKind(0.9));
      const store = createFakeStore(() => Promise.resolve({}));
      const remember = createRemember(
        createOptions({ store, estimator, extractor }),
      );

      const outcome = await remember({ read: baseRead, entry });
      const undecided = asUndecided(outcome);

      expect((undecided.error as ExtractorContractError).kind).toBe(
        "empty-text",
      );
      expect(store.writeCalls).toHaveLength(0);
    });

    test("returns undecided with a duplicate-item error and does not write", async () => {
      const extractor = extractorReturning({
        summary: "s",
        items: [
          { counterpart: "alice", text: "has a dog" },
          { counterpart: "alice", text: "has a dog" },
        ],
      });
      const estimator = createFakeEstimator(estimateBySubjectKind(0.9));
      const store = createFakeStore(() => Promise.resolve({}));
      const remember = createRemember(
        createOptions({ store, estimator, extractor }),
      );

      const outcome = await remember({ read: baseRead, entry });
      const undecided = asUndecided(outcome);

      expect((undecided.error as ExtractorContractError).kind).toBe(
        "duplicate-item",
      );
      expect(store.writeCalls).toHaveLength(0);
    });
  });

  describe("undecided results from a thrown value", () => {
    const boom = new Error("boom");

    test("returns undecided with the request itself when the extractor throws", async () => {
      const extractor = createFakeExtractor(() => Promise.reject(boom));
      const estimator = createFakeEstimator(estimateBySubjectKind(0.9));
      const store = createFakeStore(() => Promise.resolve({}));
      const remember = createRemember(
        createOptions({ store, estimator, extractor }),
      );
      const request: RememberRequest<RecallRead> = {
        read: baseRead,
        entry,
      };

      const outcome = await remember(request);
      const undecided = asUndecided(outcome);

      expect(undecided.error).toBe(boom);
      expect(undecided.request).toBe(request);
      expect(store.writeCalls).toHaveLength(0);
      expect(store.deleteCalls).toHaveLength(0);
    });

    test("returns undecided when the estimator throws", async () => {
      const extractor = extractorReturning({
        summary: "s",
        items: [{ counterpart: "alice", text: "has a dog" }],
      });
      const estimator = createFakeEstimator(() => Promise.reject(boom));
      const store = createFakeStore(() => Promise.resolve({}));
      const remember = createRemember(
        createOptions({ store, estimator, extractor }),
      );

      const outcome = await remember({ read: baseRead, entry });

      expect(outcome).toMatchObject({
        updated: false,
        reason: "undecided",
        error: boom,
      });
      expect(store.writeCalls).toHaveLength(0);
    });

    test("returns undecided when the id-making function throws", async () => {
      const extractor = extractorReturning({
        summary: "s",
        items: [{ counterpart: "alice", text: "has a dog" }],
      });
      const estimator = createFakeEstimator(estimateBySubjectKind(0.9));
      const store = createFakeStore(() => Promise.resolve({}));
      const remember = createRemember(
        createOptions({
          store,
          estimator,
          extractor,
          newId: () => {
            throw boom;
          },
        }),
      );

      const outcome = await remember({ read: baseRead, entry });

      expect(outcome).toMatchObject({
        updated: false,
        reason: "undecided",
        error: boom,
      });
      expect(store.writeCalls).toHaveLength(0);
    });

    test("returns undecided when the clock throws", async () => {
      const extractor = extractorReturning({
        summary: "s",
        items: [{ counterpart: "alice", text: "has a dog" }],
      });
      const estimator = createFakeEstimator(estimateBySubjectKind(0.9));
      const store = createFakeStore(() => Promise.resolve({}));
      const remember = createRemember(
        createOptions({
          store,
          estimator,
          extractor,
          now: () => {
            throw boom;
          },
        }),
      );

      const outcome = await remember({ read: baseRead, entry });

      expect(outcome).toMatchObject({
        updated: false,
        reason: "undecided",
        error: boom,
      });
      expect(store.writeCalls).toHaveLength(0);
    });

    test("returns undecided without rejecting when a collaborator throws an abort error", async () => {
      const abortError = Object.assign(new Error("stop"), {
        name: "AbortError",
      });
      const extractor = createFakeExtractor(() =>
        Promise.reject(abortError),
      );
      const estimator = createFakeEstimator(estimateBySubjectKind(0.9));
      const store = createFakeStore(() => Promise.resolve({}));
      const remember = createRemember(
        createOptions({ store, estimator, extractor }),
      );

      const outcome = await remember({ read: baseRead, entry });

      expect(outcome).toMatchObject({
        updated: false,
        reason: "undecided",
        error: abortError,
      });
    });
  });

  test("returns write-failed and does not call delete when the store's write throws", async () => {
    const conflict = new MemoryConflictError("jev", []);
    const extractor = extractorReturning({
      summary: "s",
      items: [{ counterpart: "alice", text: "has a dog" }],
    });
    const estimator = createFakeEstimator(estimateBySubjectKind(0.9));
    const store = createFakeStore(() => Promise.reject(conflict));
    const remember = createRemember(
      createOptions({ store, estimator, extractor }),
    );

    const outcome = await remember({ read: baseRead, entry });

    expect(outcome).toEqual({
      updated: false,
      reason: "write-failed",
      error: conflict,
    });
    expect(store.deleteCalls).toHaveLength(0);
  });

  test("returns forget-failed with what was already added when delete throws", async () => {
    const extractor = extractorReturning({
      summary: "we met; alice got a dog",
      items: [{ counterpart: "alice", text: "has a dog" }],
    });
    const estimator = createFakeEstimator(estimateBySubjectKind(0.9));
    const notFound = new MemoryItemNotFoundError("jev", ["m2"]);
    const store = createFakeStore(
      () => Promise.resolve({ m2: 3, m3: 1 }),
      () => Promise.reject(notFound),
    );
    const remember = createRemember(
      createOptions({ store, estimator, extractor }),
    );

    const outcome = await remember({ read: baseRead, entry });

    expect(outcome).toEqual({
      updated: false,
      reason: "forget-failed",
      error: notFound,
      added: ["n1"],
      personaChanged: false,
      pending: ["m2"],
    });
  });

  describe("reflection span", () => {
    const setUpKeepAndForget = () => {
      const extractor = extractorReturning({
        summary: "we met; alice got a dog",
        items: [{ counterpart: "alice", text: "has a dog" }],
      });
      const estimator = createFakeEstimator(estimateBySubjectKind(0.9));
      const store = createFakeStore(() =>
        Promise.resolve({ m2: 3, m3: 1 }),
      );
      return {
        extractor,
        estimator,
        store,
        remember: createRemember(
          createOptions({ store, estimator, extractor }),
        ),
      };
    };

    test("records the reflection span and passes it to the extractor as its trace", async () => {
      const { extractor, estimator, remember } = setUpKeepAndForget();
      const root = new RecordingSpan("root");

      await remember({ read: baseRead, entry }, { trace: root });

      expect(root.children).toHaveLength(1);
      const span = root.children[0];
      expect(span?.name).toBe(SPAN.reflection);
      expect(span?.mergedAttributes).toEqual({
        [ATTR.op]: "reflection",
        [ATTR.personaId]: "jev",
        [ATTR.reflectionModel]: estimator.model,
        [ATTR.reflectionCandidates]: 1,
        [ATTR.reflectionKept]: 1,
        [ATTR.reflectionPersonaChanged]: false,
        [ATTR.reflectionForgotten]: JSON.stringify(["m2"]),
      });
      expect(span?.endCalls).toEqual([undefined]);
      expect(extractor.extractCalls[0]?.[1]?.trace).toBe(span);
    });

    test("ends the reflection span with the thrown value when the write fails", async () => {
      const conflict = new MemoryConflictError("jev", []);
      const extractor = extractorReturning({
        summary: "s",
        items: [{ counterpart: "alice", text: "has a dog" }],
      });
      const estimator = createFakeEstimator(estimateBySubjectKind(0.9));
      const store = createFakeStore(() => Promise.reject(conflict));
      const remember = createRemember(
        createOptions({ store, estimator, extractor }),
      );
      const root = new RecordingSpan("root");

      await remember({ read: baseRead, entry }, { trace: root });

      const span = root.children[0];
      expect(span?.endCalls).toEqual([conflict]);
    });

    test("returns the same outcome when starting the span throws", async () => {
      const { remember } = setUpKeepAndForget();
      const root = new RecordingSpan("root");
      vi.spyOn(root, "startSpan").mockImplementation(() => {
        throw new Error("span");
      });

      const outcome = await remember(
        { read: baseRead, entry },
        { trace: root },
      );

      expect(outcome).toEqual({
        updated: true,
        added: ["n1"],
        personaChanged: false,
        forgotten: ["m2"],
      });
    });

    test("returns the same outcome when the child span's setAttributes and end throw", async () => {
      const { remember } = setUpKeepAndForget();
      const root = new RecordingSpan("root");
      vi.spyOn(root, "startSpan").mockImplementation(
        (name, attributes) => {
          const child = new RecordingSpan(name, attributes);
          vi.spyOn(child, "setAttributes").mockImplementation(() => {
            throw new Error("setAttributes");
          });
          vi.spyOn(child, "end").mockImplementation(() => {
            throw new Error("end");
          });
          return child;
        },
      );

      const outcome = await remember(
        { read: baseRead, entry },
        { trace: root },
      );

      expect(outcome).toEqual({
        updated: true,
        added: ["n1"],
        personaChanged: false,
        forgotten: ["m2"],
      });
    });
  });
});
