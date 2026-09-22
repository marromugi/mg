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

export interface Estimator {
  readonly model: string;
  estimate(
    request: EstimateRequest,
    options?: EstimateOptions,
  ): Promise<Estimate>;
}
