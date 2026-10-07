import type { FieldPath } from "react-hook-form";
import type { createHarnessResponse } from "../../../../api-client/index.js";
import type { HarnessValues } from "../schema.js";

export type FieldProblem = {
  at: FieldPath<HarnessValues>;
  message: string;
};

// How a save ended. A refusal names the fields of the steps its
// problems show at; a problem that belongs to none of them is in
// `others`.
export type Outcome =
  | { kind: "saved" }
  | { kind: "refused"; fields: FieldProblem[]; others: string[] }
  | { kind: "failed"; reason: string };

// The fields of the steps a field of the saved draft is asked at. The
// model is asked at one of two fields, and the rules come from the
// allowed paths.
const fieldsOf = (field: string): FieldPath<HarnessValues>[] => {
  switch (field) {
    case "name":
    case "avatar":
    case "provider":
    case "baseUrl":
    case "tools":
    case "root":
    case "maxTurns":
    case "gateQuestion":
      return [field];
    case "model":
      return ["model.listed", "model.typed"];
    default:
      return field === "rules" || field.startsWith("rules.")
        ? ["paths"]
        : [];
  }
};

export const useOutcome = (
  response: createHarnessResponse,
): Outcome => {
  switch (response.status) {
    case 201:
      return { kind: "saved" };
    case 422: {
      const fields: FieldProblem[] = [];
      const others: string[] = [];
      for (const problem of response.data.problems) {
        const places = fieldsOf(problem.field);
        if (places.length === 0) others.push(problem.message);
        for (const at of places) {
          fields.push({ at, message: problem.message });
        }
      }
      return { kind: "refused", fields, others };
    }
    case 500:
      return { kind: "failed", reason: response.data.reason };
  }
};
