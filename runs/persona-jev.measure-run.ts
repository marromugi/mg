import type { Estimator } from "@mg/core";
import { keep, personaChange, recall } from "./persona-jev.values.ts";
import type {
  KeepCandidate,
  KeepRow,
  KeepSummary,
  PersonaRow,
  PersonaScene,
  RecallInput,
  RecallRow,
  RecallSummary,
} from "./persona-measure.ts";
import {
  measureKeep,
  measurePersona,
  measureRecall,
  summarizeKeep,
  summarizePersona,
  summarizeRecall,
} from "./persona-measure.ts";

const recallInputs: RecallInput[] = [
  {
    input: "cats?",
    items: [
      {
        id: "m1",
        counterpart: "alice",
        text: "likes cats",
        createdAt: 300,
      },
      {
        id: "m2",
        counterpart: "alice",
        text: "lives in Kyoto",
        createdAt: 200,
      },
    ],
    expected: ["m1"],
  },
  {
    input: "rain?",
    items: [
      {
        id: "m1",
        counterpart: "alice",
        text: "likes cats",
        createdAt: 300,
      },
      {
        id: "m2",
        counterpart: "alice",
        text: "lives in Kyoto",
        createdAt: 200,
      },
    ],
    expected: [],
  },
  {
    input: "where do you live?",
    items: [
      {
        id: "m1",
        counterpart: "alice",
        text: "likes cats",
        createdAt: 300,
      },
      {
        id: "m2",
        counterpart: "alice",
        text: "lives in Kyoto",
        createdAt: 200,
      },
    ],
    expected: ["m2"],
  },
  {
    input: "how's go going?",
    items: [
      {
        id: "m3",
        counterpart: "bob",
        text: "plays go",
        createdAt: 100,
      },
      {
        id: "m4",
        counterpart: "bob",
        text: "hates rain",
        createdAt: 50,
      },
    ],
    expected: ["m3"],
  },
  {
    input: "did it rain today?",
    items: [
      {
        id: "m3",
        counterpart: "bob",
        text: "plays go",
        createdAt: 100,
      },
      {
        id: "m4",
        counterpart: "bob",
        text: "hates rain",
        createdAt: 50,
      },
    ],
    expected: ["m4"],
  },
];

const keepCandidates: KeepCandidate[] = [
  { counterpart: "alice", text: "has a dog", expected: true },
  { counterpart: "alice", text: "said hi", expected: false },
  { counterpart: "alice", text: "just moved to Osaka", expected: true },
  {
    counterpart: "bob",
    text: "asked what time it is",
    expected: false,
  },
  {
    counterpart: "bob",
    text: "is allergic to peanuts",
    expected: true,
  },
];

const personaScenes: PersonaScene[] = [
  {
    previous: "I am Jev.",
    proposed: "I am Jev, a dog person.",
    conversation: [
      { role: "user", author: "alice", content: "I got a dog" },
    ],
    expected: false,
  },
  {
    previous: "I am Jev.",
    proposed: "I am Bob.",
    conversation: [{ role: "user", author: "alice", content: "hi" }],
    expected: false,
  },
  {
    previous: "I am Jev.",
    proposed: "I am Jev, who loves hiking.",
    conversation: [
      {
        role: "user",
        author: "bob",
        content: "let's go hiking sometime, I love it",
      },
    ],
    expected: false,
  },
  {
    previous: "I am Jev.",
    proposed: "I am Jev, who never gives financial advice.",
    conversation: [
      {
        role: "user",
        author: "alice",
        content: "never tell me to buy a specific stock again",
      },
    ],
    expected: true,
  },
  {
    previous: "I am Jev.",
    proposed: "I am Jev, and I hate mornings.",
    conversation: [
      { role: "user", author: "bob", content: "good morning!" },
    ],
    expected: false,
  },
];

export type JevMeasureResult = {
  recall: { rows: RecallRow[]; summary: RecallSummary };
  keep: { rows: KeepRow[]; summary: KeepSummary };
  persona: { rows: PersonaRow[]; summary: KeepSummary };
  passed: boolean;
};

export const runJevMeasure = async (
  estimator: Estimator,
): Promise<JevMeasureResult> => {
  const recallRows = await measureRecall(
    estimator,
    recall,
    recallInputs,
  );
  const recallSummary = summarizeRecall(recallRows);

  const keepRows = await measureKeep(estimator, keep, keepCandidates);
  const keepSummary = summarizeKeep(keepRows);

  const personaRows = await measurePersona(
    estimator,
    personaChange,
    personaScenes,
  );
  const personaSummary = summarizePersona(personaRows);

  return {
    recall: { rows: recallRows, summary: recallSummary },
    keep: { rows: keepRows, summary: keepSummary },
    persona: { rows: personaRows, summary: personaSummary },
    passed:
      recallSummary.passed &&
      keepSummary.passed &&
      personaSummary.passed,
  };
};
