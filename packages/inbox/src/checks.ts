import { InboxInputNotJsonError } from "./errors.js";

export const assertJsonInput = (input: unknown): void => {
  if (JSON.stringify(input) === undefined) {
    throw new InboxInputNotJsonError();
  }
};
