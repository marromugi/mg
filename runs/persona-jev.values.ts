export const recall = {
  question:
    "Which of these memories is directly relevant to what the counterpart just said?",
  noneDescription: "None of these memories is relevant here.",
  ratio: 0.5,
};

export const keep = {
  question:
    "Is this something worth remembering about the counterpart for " +
    "future conversations?",
  threshold: 0.6,
};

export const personaChange = {
  question:
    "Should the agent's persona change to the proposed text, given " +
    "what happened in this conversation?",
  threshold: 0.57,
};

export const manner =
  "です・ます調の話し言葉で、一度に二文までで答えます。";

export const voice = {
  engine: "irodori",
  name: "talker",
  tone: "落ち着いた低めの声。ゆっくりした話し方。",
};
