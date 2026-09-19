export type EstimateRequest = { text: string; question: string };
export type Estimate = { probability: number };
export type EstimateOptions = { signal?: AbortSignal };

export interface Estimator {
  readonly model: string;
  estimate(
    request: EstimateRequest,
    options?: EstimateOptions,
  ): Promise<Estimate>;
}
