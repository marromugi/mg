import type {
  ClassifyRequest,
  Classification,
  Estimate,
  EstimateOptions,
  EstimateRequest,
  Estimator,
  Score,
} from "@mg/core";
import type {
  ConversationSummary,
  MemoryChange,
  MemoryItem,
  MemorySelection,
  MemoryStore,
  MemoryView,
  MissCounts,
  PersonaDocument,
} from "@mg/memory";
import { describe, expect, test } from "vitest";
import { createPersona, type PersonaOptions } from "./persona.js";
import type { Extraction, Extractor, ExtractorInput } from "./types.js";

const createFakeStore = (
  read: (
    personaId: string,
    selection: MemorySelection,
  ) => Promise<MemoryView> = () =>
    Promise.reject(new Error("not used")),
  write: (
    personaId: string,
    change: MemoryChange,
  ) => Promise<MissCounts> = () =>
    Promise.reject(new Error("not used")),
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
    read,
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

const createFakeEstimator = (
  classify: (request: ClassifyRequest) => Promise<Classification>,
  estimate: (request: EstimateRequest) => Promise<Estimate>,
  maxLabels = 4,
): Estimator => ({
  model: "estimator-1",
  limits: { maxLabels, maxLevels: 10 },
  estimate: (request: EstimateRequest, _options?: EstimateOptions) =>
    estimate(request),
  classify: (request: ClassifyRequest, _options?: EstimateOptions) =>
    classify(request),
  score: (): Promise<Score> => Promise.reject(new Error("not used")),
});

const createFakeExtractor = (
  extract: (input: ExtractorInput) => Promise<Extraction>,
): Extractor => ({
  extract: (input) => extract(input),
});

const counterparts = [
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" },
];

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

const personaDoc: PersonaDocument = { text: "I am Jev.", version: 1 };
const summaryDoc: ConversationSummary = { text: "we met", version: 2 };

const fullView = (): MemoryView => ({
  persona: personaDoc,
  items: [itemA, itemB, itemC, itemD],
  summary: summaryDoc,
});

const validOptions = (params: {
  store: MemoryStore;
  estimator: Estimator;
  extractor: Extractor;
  now?: () => number;
  newId?: () => string;
}): PersonaOptions => ({
  id: "jev",
  store: params.store,
  estimator: params.estimator,
  recall: {
    question: "Which?",
    noneDescription: "None.",
    ratio: 0.5,
    headings: { about: "## About", earlier: "## Earlier" },
  },
  extractor: params.extractor,
  keep: { question: "Keep?", threshold: 0.6 },
  persona: { question: "Accept?", threshold: 0.8 },
  forgetting: { missLimit: 3, itemsPerCounterpart: 2 },
  ...(params.now !== undefined ? { now: params.now } : {}),
  ...(params.newId !== undefined ? { newId: params.newId } : {}),
});

describe("createPersona", () => {
  test("builds a persona whose id, recall and remember delegate to the recall and reflection parts", async () => {
    const store = createFakeStore(
      () => Promise.resolve(fullView()),
      () => Promise.resolve({ m3: 1 }),
    );
    const estimator = createFakeEstimator(
      () =>
        Promise.resolve({
          label: "0",
          probabilities: { "0": 0.6, "1": 0.3, "2": 0.05, none: 0.05 },
        }),
      () => Promise.resolve({ probability: 0.9 }),
    );
    const extractor = createFakeExtractor(() =>
      Promise.resolve({
        summary: "alice got a dog",
        items: [{ counterpart: "alice", text: "has a dog" }],
      }),
    );
    const persona = createPersona(
      validOptions({
        store,
        estimator,
        extractor,
        now: () => 400,
        newId: () => "n1",
      }),
    );

    expect(persona.id).toBe("jev");

    const recallResult = await persona.recall({
      counterparts,
      conversation: "t1",
      input: "cats?",
    });

    expect(recallResult.instruction).toBe(
      "I am Jev.\n\n## About Alice\n- likes cats\n- lives in Kyoto\n\n## Earlier\nwe met",
    );
    expect(recallResult.read).toEqual({
      counterparts,
      conversation: "t1",
      persona: personaDoc,
      summary: summaryDoc,
      items: [itemA, itemB, itemC, itemD],
      candidates: ["m1", "m2", "m3"],
      selected: ["m1", "m2"],
    });

    const rememberOutcome = await persona.remember({
      read: recallResult.read,
      entry: [{ role: "user", content: "alice: I got a dog" }],
    });

    expect(store.writeCalls).toEqual([
      [
        "jev",
        {
          summary: {
            conversation: "t1",
            text: "alice got a dog",
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
          hits: ["m1", "m2"],
          misses: ["m3"],
        },
      ],
    ]);
    expect(store.deleteCalls).toEqual([["jev", ["m2"]]]);
    expect(rememberOutcome).toEqual({
      updated: true,
      added: ["n1"],
      personaChanged: false,
      forgotten: ["m2"],
    });
  });

  test("uses Date.now and a 21-character nanoid when the clock and id-making function are omitted", async () => {
    const store = createFakeStore(
      () =>
        Promise.resolve({
          persona: personaDoc,
          items: [],
        }),
      () => Promise.resolve({}),
    );
    const estimator = createFakeEstimator(
      () => Promise.reject(new Error("not used")),
      () => Promise.resolve({ probability: 0.9 }),
    );
    const extractor = createFakeExtractor(() =>
      Promise.resolve({
        summary: "alice got a dog",
        items: [{ counterpart: "alice", text: "has a dog" }],
      }),
    );
    const persona = createPersona(
      validOptions({ store, estimator, extractor }),
    );
    const recallResult = await persona.recall({
      counterparts,
      conversation: "t1",
      input: "cats?",
    });

    const before = Date.now();
    await persona.remember({
      read: recallResult.read,
      entry: [{ role: "user", content: "alice: I got a dog" }],
    });
    const after = Date.now();

    const change = store.writeCalls[0]?.[1];
    const added = change?.add?.[0];
    expect(added?.createdAt).toBeGreaterThanOrEqual(before);
    expect(added?.createdAt).toBeLessThanOrEqual(after);
    expect(added?.id).toHaveLength(21);
  });

  describe("rejects with RangeError at construction", () => {
    const store = createFakeStore();
    const estimator = createFakeEstimator(
      () => Promise.reject(new Error("not used")),
      () => Promise.reject(new Error("not used")),
    );
    const extractor = createFakeExtractor(() =>
      Promise.reject(new Error("not used")),
    );

    const baseValidOptions = (): PersonaOptions =>
      validOptions({ store, estimator, extractor });

    test("when the persona id is blank", () => {
      const options = { ...baseValidOptions(), id: " " };
      expect(() => createPersona(options)).toThrow(RangeError);
    });

    test("when the recall question is empty", () => {
      const options = baseValidOptions();
      options.recall = { ...options.recall, question: "" };
      expect(() => createPersona(options)).toThrow(RangeError);
    });

    test("when the none-description is blank", () => {
      const options = baseValidOptions();
      options.recall = { ...options.recall, noneDescription: " " };
      expect(() => createPersona(options)).toThrow(RangeError);
    });

    test("when the about heading is empty", () => {
      const options = baseValidOptions();
      options.recall = {
        ...options.recall,
        headings: { ...options.recall.headings, about: "" },
      };
      expect(() => createPersona(options)).toThrow(RangeError);
    });

    test("when the recall ratio is above 1", () => {
      const options = baseValidOptions();
      options.recall = { ...options.recall, ratio: 1.5 };
      expect(() => createPersona(options)).toThrow(RangeError);
    });

    test("when the keep threshold is NaN", () => {
      const options = baseValidOptions();
      options.keep = { ...options.keep, threshold: Number.NaN };
      expect(() => createPersona(options)).toThrow(RangeError);
    });

    test("when the persona threshold is negative", () => {
      const options = baseValidOptions();
      options.persona = { ...options.persona, threshold: -0.1 };
      expect(() => createPersona(options)).toThrow(RangeError);
    });

    test("when the forgetting miss limit is 0", () => {
      const options = baseValidOptions();
      options.forgetting = { ...options.forgetting, missLimit: 0 };
      expect(() => createPersona(options)).toThrow(RangeError);
    });

    test("when the items-per-counterpart limit is not an integer", () => {
      const options = baseValidOptions();
      options.forgetting = {
        ...options.forgetting,
        itemsPerCounterpart: 1.5,
      };
      expect(() => createPersona(options)).toThrow(RangeError);
    });

    test("when the items-per-counterpart limit exceeds limits.maxLabels minus 1", () => {
      const options = baseValidOptions();
      options.forgetting = {
        ...options.forgetting,
        itemsPerCounterpart: 4,
      };
      expect(() => createPersona(options)).toThrow(RangeError);
    });

    test("when the estimator's limits.maxLabels is 1", () => {
      const narrowEstimator = createFakeEstimator(
        () => Promise.reject(new Error("not used")),
        () => Promise.reject(new Error("not used")),
        1,
      );
      const options = validOptions({
        store,
        estimator: narrowEstimator,
        extractor,
      });
      expect(() => createPersona(options)).toThrow(RangeError);
    });
  });
});
