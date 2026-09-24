import type {
  ClassifyRequest,
  Classification,
  Estimate,
  EstimateOptions,
  Estimator,
  Score,
} from "@mg/core";
import type {
  ConversationSummary,
  MemoryItem,
  MemorySelection,
  MemoryStore,
  MemoryView,
  PersonaDocument,
} from "@mg/memory";
import { PersonaNotFoundError } from "@mg/memory";
import { ATTR, SPAN } from "@mg/trace";
import { describe, expect, test, vi } from "vitest";
import { RecallError } from "./errors.js";
import { createRecall, type RecallOptions } from "./recall.js";
import { RecordingSpan } from "./recording-span.test-helper.js";
import type { Counterpart } from "./types.js";

const createFakeStore = (
  read: (
    personaId: string,
    selection: MemorySelection,
  ) => Promise<MemoryView>,
): MemoryStore & {
  readCalls: Array<[string, MemorySelection]>;
} => {
  const readCalls: Array<[string, MemorySelection]> = [];
  return {
    readCalls,
    create: () => Promise.reject(new Error("not used")),
    read: (personaId, selection) => {
      readCalls.push([personaId, selection]);
      return read(personaId, selection);
    },
    write: () => Promise.reject(new Error("not used")),
    delete: () => Promise.reject(new Error("not used")),
  };
};

const createFakeEstimator = (
  classify: (
    request: ClassifyRequest,
    options?: EstimateOptions,
  ) => Promise<Classification>,
): Estimator & {
  classifyCalls: Array<[ClassifyRequest, EstimateOptions | undefined]>;
} => {
  const classifyCalls: Array<
    [ClassifyRequest, EstimateOptions | undefined]
  > = [];
  return {
    model: "estimator-1",
    limits: { maxLabels: 4, maxLevels: 10 },
    classifyCalls,
    estimate: (): Promise<Estimate> =>
      Promise.reject(new Error("not used")),
    classify: (request, options) => {
      classifyCalls.push([request, options]);
      return classify(request, options);
    },
    score: (): Promise<Score> => Promise.reject(new Error("not used")),
  };
};

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
  misses: 1,
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

const counterparts: Counterpart[] = [
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" },
];
const conversation = "t1";
const input = "cats?";

const persona: PersonaDocument = { text: "I am Jev.", version: 1 };
const summary: ConversationSummary = { text: "we met", version: 2 };

const baseOptions: Omit<RecallOptions, "store" | "estimator"> = {
  id: "jev",
  question: "Which memories matter?",
  noneDescription: "None of these matters.",
  ratio: 0.5,
  headings: { about: "## About", earlier: "## Earlier" },
};

const fullView = (): MemoryView => ({
  persona,
  items: [itemA, itemB, itemC, itemD],
  summary,
});

describe("recall", () => {
  test("reads the store by counterpart ids and conversation, and classifies with the candidate texts as labels", async () => {
    const store = createFakeStore(() => Promise.resolve(fullView()));
    const estimator = createFakeEstimator(() =>
      Promise.resolve({
        label: "0",
        probabilities: { "0": 0.6, "1": 0.3, "2": 0.05, none: 0.05 },
      }),
    );
    const recall = createRecall({ ...baseOptions, store, estimator });

    await recall({ counterparts, conversation, input });

    expect(store.readCalls).toEqual([
      ["jev", { counterparts: ["alice", "bob"], conversation: "t1" }],
    ]);
    expect(estimator.classifyCalls).toHaveLength(1);
    expect(estimator.classifyCalls[0]?.[0]).toEqual({
      subject: "cats?",
      question: "Which memories matter?",
      labels: {
        "0": "likes cats",
        "1": "lives in Kyoto",
        "2": "plays go",
        none: "None of these matters.",
      },
    });
  });

  test("passes the context signal through to classify unchanged", async () => {
    const store = createFakeStore(() => Promise.resolve(fullView()));
    const estimator = createFakeEstimator(() =>
      Promise.resolve({
        label: "0",
        probabilities: { "0": 0.6, "1": 0.3, "2": 0.05, none: 0.05 },
      }),
    );
    const recall = createRecall({ ...baseOptions, store, estimator });
    const controller = new AbortController();

    await recall(
      { counterparts, conversation, input },
      { signal: controller.signal },
    );

    expect(estimator.classifyCalls[0]?.[1]?.signal).toBe(
      controller.signal,
    );
  });

  test("returns an instruction built from the persona, the selected items per counterpart and the summary, plus the full read", async () => {
    const store = createFakeStore(() => Promise.resolve(fullView()));
    const estimator = createFakeEstimator(() =>
      Promise.resolve({
        label: "0",
        probabilities: { "0": 0.6, "1": 0.3, "2": 0.05, none: 0.05 },
      }),
    );
    const recall = createRecall({ ...baseOptions, store, estimator });

    const result = await recall({ counterparts, conversation, input });

    expect(result.instruction).toBe(
      "I am Jev.\n\n## About Alice\n- likes cats\n- lives in Kyoto\n\n## Earlier\nwe met",
    );
    expect(result.read).toEqual({
      counterparts: [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
      ],
      conversation: "t1",
      persona,
      summary,
      items: [itemA, itemB, itemC, itemD],
      candidates: ["m1", "m2", "m3"],
      selected: ["m1", "m2"],
    });
  });

  test("selects nothing and omits the counterpart sections when the classifier picks none", async () => {
    const store = createFakeStore(() => Promise.resolve(fullView()));
    const estimator = createFakeEstimator(() =>
      Promise.resolve({
        label: "none",
        probabilities: { "0": 0.4, "1": 0.1, "2": 0.1, none: 0.4 },
      }),
    );
    const recall = createRecall({ ...baseOptions, store, estimator });

    const result = await recall({ counterparts, conversation, input });

    expect(result.read.selected).toEqual([]);
    expect(result.instruction).toBe("I am Jev.\n\n## Earlier\nwe met");
  });

  test("skips classification and reports no candidates when there are no items to recall", async () => {
    const store = createFakeStore(() =>
      Promise.resolve({ persona, items: [] }),
    );
    const estimator = createFakeEstimator(() =>
      Promise.reject(new Error("not used")),
    );
    const recall = createRecall({ ...baseOptions, store, estimator });

    const result = await recall({ counterparts, conversation, input });

    expect(estimator.classifyCalls).toHaveLength(0);
    expect(result.instruction).toBe("I am Jev.");
    expect(result.read.candidates).toEqual([]);
    expect(result.read.selected).toEqual([]);
  });

  test("rejects with RangeError and does not read the store when a counterpart id is duplicated", async () => {
    const store = createFakeStore(() =>
      Promise.resolve({ persona, items: [] }),
    );
    const estimator = createFakeEstimator(() =>
      Promise.reject(new Error("not used")),
    );
    const recall = createRecall({ ...baseOptions, store, estimator });

    await expect(
      recall({
        counterparts: [
          { id: "alice", name: "Alice" },
          { id: "alice", name: "A" },
        ],
        conversation,
        input,
      }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(store.readCalls).toHaveLength(0);
  });

  test("rejects with RangeError and does not read the store when a display name is blank", async () => {
    const store = createFakeStore(() =>
      Promise.resolve({ persona, items: [] }),
    );
    const estimator = createFakeEstimator(() =>
      Promise.reject(new Error("not used")),
    );
    const recall = createRecall({ ...baseOptions, store, estimator });

    await expect(
      recall({
        counterparts: [
          { id: "alice", name: " " },
          { id: "bob", name: "Bob" },
        ],
        conversation,
        input,
      }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(store.readCalls).toHaveLength(0);
  });

  test("rejects with RangeError and does not read the store when the conversation id is blank", async () => {
    const store = createFakeStore(() =>
      Promise.resolve({ persona, items: [] }),
    );
    const estimator = createFakeEstimator(() =>
      Promise.reject(new Error("not used")),
    );
    const recall = createRecall({ ...baseOptions, store, estimator });

    await expect(
      recall({ counterparts, conversation: "", input }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(store.readCalls).toHaveLength(0);
  });

  test("wraps an estimator failure in RecallError with the original error as cause", async () => {
    const store = createFakeStore(() => Promise.resolve(fullView()));
    const cause = new Error("down");
    const estimator = createFakeEstimator(() => Promise.reject(cause));
    const recall = createRecall({ ...baseOptions, store, estimator });

    const error: unknown = await recall({
      counterparts,
      conversation,
      input,
    }).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(RecallError);
    expect((error as RecallError).cause).toBe(cause);
  });

  test("passes an abort error from the estimator through unchanged", async () => {
    const abortError = Object.assign(new Error("stop"), {
      name: "AbortError",
    });
    const store = createFakeStore(() => Promise.resolve(fullView()));
    const estimator = createFakeEstimator(() =>
      Promise.reject(abortError),
    );
    const recall = createRecall({ ...baseOptions, store, estimator });

    await expect(
      recall({ counterparts, conversation, input }),
    ).rejects.toBe(abortError);
  });

  test("passes a store failure through unchanged", async () => {
    const storeError = new PersonaNotFoundError("jev");
    const store = createFakeStore(() => Promise.reject(storeError));
    const estimator = createFakeEstimator(() =>
      Promise.reject(new Error("not used")),
    );
    const recall = createRecall({ ...baseOptions, store, estimator });

    await expect(
      recall({ counterparts, conversation, input }),
    ).rejects.toBe(storeError);
  });

  test("records the recall span with the model, candidate count, selected ids and probabilities", async () => {
    const store = createFakeStore(() => Promise.resolve(fullView()));
    const estimator = createFakeEstimator(() =>
      Promise.resolve({
        label: "0",
        probabilities: { "0": 0.6, "1": 0.3, "2": 0.05, none: 0.05 },
      }),
    );
    const recall = createRecall({ ...baseOptions, store, estimator });
    const root = new RecordingSpan("root");

    await recall(
      { counterparts, conversation, input },
      { trace: root },
    );

    expect(root.children).toHaveLength(1);
    const span = root.children[0];
    expect(span?.name).toBe(SPAN.recall);
    expect(span?.mergedAttributes).toEqual({
      [ATTR.op]: "recall",
      [ATTR.personaId]: "jev",
      [ATTR.recallModel]: estimator.model,
      [ATTR.recallCandidates]: 3,
      [ATTR.recallSelected]: JSON.stringify(["m1", "m2"]),
      [ATTR.recallProbabilities]: JSON.stringify({
        "0": 0.6,
        "1": 0.3,
        "2": 0.05,
        none: 0.05,
      }),
    });
    expect(span?.endCalls).toEqual([undefined]);
  });

  test("omits probabilities and reports zero candidates on the span when there are no items to recall", async () => {
    const store = createFakeStore(() =>
      Promise.resolve({ persona, items: [] }),
    );
    const estimator = createFakeEstimator(() =>
      Promise.reject(new Error("not used")),
    );
    const recall = createRecall({ ...baseOptions, store, estimator });
    const root = new RecordingSpan("root");

    await recall(
      { counterparts, conversation, input },
      { trace: root },
    );

    const span = root.children[0];
    expect(span?.mergedAttributes[ATTR.recallCandidates]).toBe(0);
    expect(
      span !== undefined &&
        ATTR.recallProbabilities in span.mergedAttributes,
    ).toBe(false);
  });

  test("returns the same result even when starting the span throws", async () => {
    const store = createFakeStore(() => Promise.resolve(fullView()));
    const estimator = createFakeEstimator(() =>
      Promise.resolve({
        label: "0",
        probabilities: { "0": 0.6, "1": 0.3, "2": 0.05, none: 0.05 },
      }),
    );
    const recall = createRecall({ ...baseOptions, store, estimator });
    const root = new RecordingSpan("root");
    vi.spyOn(root, "startSpan").mockImplementation(() => {
      throw new Error("span");
    });

    const result = await recall(
      { counterparts, conversation, input },
      { trace: root },
    );

    expect(result.instruction).toBe(
      "I am Jev.\n\n## About Alice\n- likes cats\n- lives in Kyoto\n\n## Earlier\nwe met",
    );
    expect(result.read).toEqual({
      counterparts,
      conversation: "t1",
      persona,
      summary,
      items: [itemA, itemB, itemC, itemD],
      candidates: ["m1", "m2", "m3"],
      selected: ["m1", "m2"],
    });
  });

  test("returns the same result even when the child span's setAttributes and end throw", async () => {
    const store = createFakeStore(() => Promise.resolve(fullView()));
    const estimator = createFakeEstimator(() =>
      Promise.resolve({
        label: "0",
        probabilities: { "0": 0.6, "1": 0.3, "2": 0.05, none: 0.05 },
      }),
    );
    const recall = createRecall({ ...baseOptions, store, estimator });
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

    const result = await recall(
      { counterparts, conversation, input },
      { trace: root },
    );

    expect(result.instruction).toBe(
      "I am Jev.\n\n## About Alice\n- likes cats\n- lives in Kyoto\n\n## Earlier\nwe met",
    );
  });

  test("ends the recall span with the RecallError when the estimator fails", async () => {
    const store = createFakeStore(() => Promise.resolve(fullView()));
    const cause = new Error("down");
    const estimator = createFakeEstimator(() => Promise.reject(cause));
    const recall = createRecall({ ...baseOptions, store, estimator });
    const root = new RecordingSpan("root");

    const error: unknown = await recall(
      { counterparts, conversation, input },
      { trace: root },
    ).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(RecallError);
    const span = root.children[0];
    expect(span?.endCalls).toEqual([error]);
  });

  test("orders counterpart sections by the counterpart list and items within a section by candidate order", async () => {
    const store = createFakeStore(() => Promise.resolve(fullView()));
    const estimator = createFakeEstimator(() =>
      Promise.resolve({
        label: "0",
        probabilities: { "0": 0.6, "1": 0.3, "2": 0.4, none: 0.05 },
      }),
    );
    const recall = createRecall({ ...baseOptions, store, estimator });
    const reordered: Counterpart[] = [
      { id: "bob", name: "Bob" },
      { id: "alice", name: "Alice" },
    ];

    const result = await recall({
      counterparts: reordered,
      conversation,
      input,
    });

    expect(result.instruction).toBe(
      "I am Jev.\n\n## About Bob\n- plays go\n\n## About Alice\n- likes cats\n- lives in Kyoto\n\n## Earlier\nwe met",
    );
    expect(result.read.selected).toEqual(["m1", "m2", "m3"]);
  });
});
