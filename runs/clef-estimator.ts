import type { ClefModel, Estimator } from "@mg/core";
import { createClefEstimator } from "@mg/core";
import { withSampleRetry } from "./jev-estimator.ts";

// `inside` wraps the estimator that talks to the service, below the
// retries, so it sees each request on its own.
export const createSampleClefEstimator = (options: {
  accountId: string;
  apiToken: string;
  model?: ClefModel;
  inside?: (estimator: Estimator) => Estimator;
}): Estimator =>
  withSampleRetry(
    (options.inside ?? ((estimator) => estimator))(
      createClefEstimator({
        accountId: options.accountId,
        apiToken: options.apiToken,
        ...(options.model === undefined
          ? {}
          : { model: options.model }),
      }),
    ),
  );
