export type EstimatorSubjectValue =
  | string
  | number
  | boolean
  | null
  | EstimatorSubjectValue[]
  | { [key: string]: EstimatorSubjectValue };

export type EstimatorSubject =
  | string
  | EstimatorSubjectValue[]
  | { [key: string]: EstimatorSubjectValue };

export type EstimateRequest = {
  subject: EstimatorSubject;
  question: string;
};
export type Estimate = { probability: number };
export type EstimateOptions = { signal?: AbortSignal };

export type ClassifyRequest = {
  subject: EstimatorSubject;
  question: string;
  labels: Record<string, string>;
};
export type Classification = {
  label: string;
  probabilities: Record<string, number>;
};

export type ScoreRequest = {
  subject: EstimatorSubject;
  question: string;
  levels: readonly [string, string, ...string[]];
};
export type Score = { score: number; probabilities: number[] };

export type EstimatorLimits = { maxLabels: number; maxLevels: number };

export interface Estimator {
  readonly model: string;
  readonly limits: EstimatorLimits;
  estimate(
    request: EstimateRequest,
    options?: EstimateOptions,
  ): Promise<Estimate>;
  classify(
    request: ClassifyRequest,
    options?: EstimateOptions,
  ): Promise<Classification>;
  score(
    request: ScoreRequest,
    options?: EstimateOptions,
  ): Promise<Score>;
}
