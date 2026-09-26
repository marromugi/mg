// 書き方は packages/runner/agent-guide.md を見てください。
import { createJevEstimator } from "@mg/core";
import type {
  KeepCandidate,
  PersonaScene,
  RecallInput,
} from "./persona-measure.ts";
import {
  measureKeep,
  measurePersona,
  measureRecall,
  summarizeKeep,
  summarizePersona,
  summarizeRecall,
} from "./persona-measure.ts";

const apiKey = process.env.TYPESAFE_API_KEY;
if (apiKey === undefined)
  throw new Error("TYPESAFE_API_KEY is not set");

const estimator = createJevEstimator({ apiKey });

const recallQuestion =
  "Which of these memories about the counterparts matters for " +
  "replying to the current message?";
const noneDescription = "None of these memories matters here.";
const recallRatio = 0.5;

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

const keepQuestion =
  "Is this something worth remembering about the counterpart for " +
  "future conversations?";
const keepThreshold = 0.6;

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

const personaQuestion =
  "Should the agent's persona change to the proposed text, given " +
  "what happened in this conversation?";
const personaThreshold = 0.8;

const personaScenes: PersonaScene[] = [
  {
    previous: "I am Jev.",
    proposed: "I am Jev, a dog person.",
    conversation: "[user]\nalice: I got a dog",
    expected: true,
  },
  {
    previous: "I am Jev.",
    proposed: "I am Bob.",
    conversation: "[user]\nhi",
    expected: false,
  },
  {
    previous: "I am Jev.",
    proposed: "I am Jev, who loves hiking.",
    conversation: "[user]\nbob: let's go hiking sometime, I love it",
    expected: false,
  },
  {
    previous: "I am Jev.",
    proposed: "I am Jev, who never gives financial advice.",
    conversation:
      "[user]\nalice: never tell me to buy a specific stock again",
    expected: true,
  },
  {
    previous: "I am Jev.",
    proposed: "I am Jev, and I hate mornings.",
    conversation: "[user]\nbob: good morning!",
    expected: false,
  },
];

const recallRows = await measureRecall(
  estimator,
  { question: recallQuestion, noneDescription, ratio: recallRatio },
  recallInputs,
);
for (const row of recallRows) console.log(JSON.stringify(row));
const recallSummary = summarizeRecall(recallRows);
console.log(JSON.stringify(recallSummary));

const keepRows = await measureKeep(
  estimator,
  { question: keepQuestion, threshold: keepThreshold },
  keepCandidates,
);
for (const row of keepRows) console.log(JSON.stringify(row));
const keepSummary = summarizeKeep(keepRows);
console.log(JSON.stringify(keepSummary));

const personaRows = await measurePersona(
  estimator,
  { question: personaQuestion, threshold: personaThreshold },
  personaScenes,
);
for (const row of personaRows) console.log(JSON.stringify(row));
const personaSummary = summarizePersona(personaRows);
console.log(JSON.stringify(personaSummary));

if (
  !recallSummary.passed ||
  !keepSummary.passed ||
  !personaSummary.passed
) {
  process.exitCode = 1;
}
