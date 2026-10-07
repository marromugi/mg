import { zodResolver } from "@hookform/resolvers/zod";
import {
  useForm,
  type FieldValues,
  type UseFormProps,
  type UseFormReturn,
} from "react-hook-form";
import type { z } from "zod";

// A form whose values are checked by `schema`: the values it holds are
// what the schema takes in, and what it hands to a submit handler is
// what the schema gives out.
export const useZodForm = <
  Input extends FieldValues,
  Output extends FieldValues,
>(
  schema: z.ZodType<Output, Input>,
  options?: Omit<UseFormProps<Input, unknown, Output>, "resolver">,
): UseFormReturn<Input, unknown, Output> =>
  useForm<Input, unknown, Output>({
    ...options,
    resolver: zodResolver(schema),
  });
