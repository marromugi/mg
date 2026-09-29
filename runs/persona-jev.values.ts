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
  threshold: 0.8,
};
