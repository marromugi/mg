import type {
  Classification,
  ClassifyRequest,
  Estimate,
  EstimateRequest,
  Estimator,
  Score,
} from "@mg/core";
import { describe, expect, test } from "vitest";
import { runJevMeasure } from "./persona-jev.measure-run.ts";

const NONE = "None of these memories is relevant here.";

type Recorded = Estimator & {
  classifyCalls: ClassifyRequest[];
  estimateCalls: EstimateRequest[];
};

const createFake = (options: {
  classify: (request: ClassifyRequest) => Classification;
  estimate: (request: EstimateRequest) => number;
}): Recorded => {
  const classifyCalls: ClassifyRequest[] = [];
  const estimateCalls: EstimateRequest[] = [];
  return {
    classifyCalls,
    estimateCalls,
    model: "fake",
    limits: { maxLabels: 255, maxLevels: 10 },
    estimate: (request): Promise<Estimate> => {
      estimateCalls.push(request);
      return Promise.resolve({
        probability: options.estimate(request),
      });
    },
    classify: (request): Promise<Classification> => {
      classifyCalls.push(request);
      return Promise.resolve(options.classify(request));
    },
    score: (): Promise<Score> => Promise.reject(new Error("not used")),
  };
};

const classifyPicking =
  (chosen: (request: ClassifyRequest) => string) =>
  (request: ClassifyRequest): Classification => {
    const picked = chosen(request);
    const probabilities = Object.fromEntries(
      Object.entries(request.labels).map(([label, description]) => [
        label,
        description === picked ? 0.9 : 0.05,
      ]),
    );
    const label =
      Object.keys(request.labels).find(
        (key) => request.labels[key] === picked,
      ) ?? "none";
    return { label, probabilities };
  };

const expectedRecall: Record<string, string> = {
  "cats?": "likes cats",
  "rain?": NONE,
  "where do you live?": "lives in Kyoto",
  "how's go going?": "plays go",
  "did it rain today?": "hates rain",
};

const field = (request: EstimateRequest, name: string): unknown =>
  (request.subject as Record<string, unknown>)[name];

const keptTexts = [
  "has a dog",
  "just moved to Osaka",
  "is allergic to peanuts",
];
const acceptedProposals = [
  "I am Jev, who never gives financial advice.",
];

const estimateFor =
  (personaProbability: (accepted: boolean) => number) =>
  (request: EstimateRequest): number => {
    const text = field(request, "text");
    if (typeof text === "string") {
      return keptTexts.includes(text) ? 0.6 : 0.59;
    }
    return personaProbability(
      acceptedProposals.includes(field(request, "proposed") as string),
    );
  };

const runWithNoneAndLowProbability = async () => {
  const estimator = createFake({
    classify: classifyPicking(() => NONE),
    estimate: () => 0.1,
  });
  await runJevMeasure(estimator);
  return estimator;
};

describe("runJevMeasure", () => {
  test("asks the recall, keep and persona questions", async () => {
    const estimator = await runWithNoneAndLowProbability();

    expect(estimator.classifyCalls).toHaveLength(5);
    for (const call of estimator.classifyCalls) {
      expect(call.question).toBe(
        "Which of these memories is directly relevant to what the counterpart just said?",
      );
      expect(call.labels.none).toBe(NONE);
    }
    const keepCalls = estimator.estimateCalls.filter(
      (call) => field(call, "counterpart") !== undefined,
    );
    expect(keepCalls).toHaveLength(5);
    for (const call of keepCalls) {
      expect(call.question).toBe(
        "Is this something worth remembering about the counterpart for future conversations?",
      );
    }
    const personaCalls = estimator.estimateCalls.filter(
      (call) => field(call, "previous") !== undefined,
    );
    expect(personaCalls).toHaveLength(5);
    for (const call of personaCalls) {
      expect(call.question).toBe(
        "Should the agent's persona change to the proposed text, given what happened in this conversation?",
      );
    }
  });

  test("passes when all three summaries pass and fails when the persona summary fails", async () => {
    const classify = classifyPicking(
      (request) => expectedRecall[request.subject as string],
    );
    const passing = await runJevMeasure(
      createFake({
        classify,
        estimate: estimateFor((accepted) => (accepted ? 0.8 : 0.79)),
      }),
    );
    const failing = await runJevMeasure(
      createFake({ classify, estimate: estimateFor(() => 0.79) }),
    );

    expect(passing.recall.summary.passed).toBe(true);
    expect(passing.keep.summary.passed).toBe(true);
    expect(passing.persona.summary.passed).toBe(true);
    expect(passing.passed).toBe(true);
    expect(failing.persona.summary.passed).toBe(false);
    expect(failing.passed).toBe(false);
  });

  test("fails the persona summary when the dog proposal is accepted", async () => {
    const acceptedByThisFake = [
      "I am Jev, a dog person.",
      "I am Jev, who never gives financial advice.",
    ];
    const result = await runJevMeasure(
      createFake({
        classify: classifyPicking(
          (request) => expectedRecall[request.subject as string],
        ),
        estimate: (request) => {
          const text = field(request, "text");
          if (typeof text === "string") {
            return keptTexts.includes(text) ? 0.6 : 0.59;
          }
          return acceptedByThisFake.includes(
            field(request, "proposed") as string,
          )
            ? 0.8
            : 0.79;
        },
      }),
    );

    const dogRow = result.persona.rows.find(
      (row) => row.proposed === "I am Jev, a dog person.",
    );
    expect(result.persona.summary.passed).toBe(false);
    expect(dogRow?.matched).toBe(false);
  });

  test("hands the persona judgment each scene as a transcript with its author", async () => {
    const estimator = await runWithNoneAndLowProbability();

    const conversationOf = (proposed: string): unknown => {
      const call = estimator.estimateCalls.find(
        (candidate) => field(candidate, "proposed") === proposed,
      );
      if (call === undefined) throw new Error("no such scene");
      return field(call, "conversation");
    };
    expect(conversationOf("I am Jev, a dog person.")).toBe(
      '[user "alice"]\nI got a dog',
    );
    expect(conversationOf("I am Bob.")).toBe('[user "alice"]\nhi');
    expect(conversationOf("I am Jev, who loves hiking.")).toBe(
      '[user "bob"]\nlet\'s go hiking sometime, I love it',
    );
    expect(
      conversationOf("I am Jev, who never gives financial advice."),
    ).toBe(
      '[user "alice"]\nnever tell me to buy a specific stock again',
    );
    expect(conversationOf("I am Jev, and I hate mornings.")).toBe(
      '[user "bob"]\ngood morning!',
    );
  });
});
