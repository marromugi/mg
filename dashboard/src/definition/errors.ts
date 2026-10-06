// `field` is the path of the wrong value in the definition, such as
// "harness.maxTurns" or "means.rules.0.paths". "" means the whole value.
export type Problem = { field: string; message: string };
