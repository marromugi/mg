import type {
  Classification,
  ClassifyRequest,
  Estimate,
  Estimator,
  Provider,
  Score,
} from "@mg/core";
import { createMemoryStore } from "@mg/memory";
import { describe, expect, test } from "vitest";
import { buildJevPersona } from "./persona-jev.build.ts";

const createFakeEstimator = (
  probabilityOf: (description: string) => number,
): Estimator & { classifyCalls: ClassifyRequest[] } => {
  const classifyCalls: ClassifyRequest[] = [];
  return {
    classifyCalls,
    model: "fake",
    limits: { maxLabels: 255, maxLevels: 10 },
    estimate: (): Promise<Estimate> =>
      Promise.reject(new Error("not used")),
    classify: (request): Promise<Classification> => {
      classifyCalls.push(request);
      const probabilities = Object.fromEntries(
        Object.entries(request.labels).map(([label, description]) => [
          label,
          probabilityOf(description),
        ]),
      );
      const label = Object.keys(probabilities).reduce((best, next) =>
        probabilities[next] > probabilities[best] ? next : best,
      );
      return Promise.resolve({ label, probabilities });
    },
    score: (): Promise<Score> => Promise.reject(new Error("not used")),
  };
};

const failingProvider: Provider = {
  toolForcing: true,
  generate: () =>
    Promise.reject(new Error("provider must not be called")),
  stream: () => {
    throw new Error("provider must not be called");
  },
};

const createStore = async () => {
  const store = createMemoryStore();
  await store.create("jev", "I am Jev.");
  await store.write("jev", {
    add: [
      {
        id: "m3",
        counterpart: "user",
        text: "plays go",
        createdAt: 100,
      },
      {
        id: "m4",
        counterpart: "user",
        text: "hates rain",
        createdAt: 50,
      },
    ],
  });
  return store;
};

const recallWith = async (
  probabilityOf: (description: string) => number,
) => {
  const estimator = createFakeEstimator(probabilityOf);
  const persona = buildJevPersona({
    store: await createStore(),
    estimator,
    extractorProvider: failingProvider,
  });
  const recalled = await persona.recall({
    counterparts: [{ id: "user", name: "User" }],
    conversation: "c1",
    input: "did it rain today?",
  });
  return { estimator, read: recalled.read };
};

describe("buildJevPersona recall", () => {
  test("asks the recall question with the none description", async () => {
    const { estimator, read } = await recallWith((description) =>
      description === "hates rain" ? 0.9 : 0.05,
    );

    expect(estimator.classifyCalls).toHaveLength(1);
    expect(estimator.classifyCalls[0].question).toBe(
      "Which of these memories is directly relevant to what the counterpart just said?",
    );
    expect(estimator.classifyCalls[0].labels.none).toBe(
      "None of these memories is relevant here.",
    );
    expect(read.selected).toEqual(["m4"]);
  });

  test("selects every memory whose probability is at least half of the top one", async () => {
    const atHalf = await recallWith((description) => {
      if (description === "hates rain") return 0.5;
      if (description === "plays go") return 0.26;
      return 0.24;
    });
    const belowHalf = await recallWith((description) => {
      if (description === "hates rain") return 0.5;
      if (description === "plays go") return 0.24;
      return 0.26;
    });

    expect([...atHalf.read.selected].sort()).toEqual(["m3", "m4"]);
    expect(belowHalf.read.selected).toEqual(["m4"]);
  });
});
