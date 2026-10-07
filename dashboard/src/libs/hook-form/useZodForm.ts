import { zodResolver } from "@hookform/resolvers/zod";
import {
  useForm,
  type FieldValues,
  type Resolver,
  type UseFormProps,
  type UseFormReturn,
} from "react-hook-form";
import type { z } from "zod";

// A form whose values are checked by `schema`: the values it holds are
// what the schema takes in, and what it hands to a submit handler is
// what the schema gives out.
export const useZodForm = <
  Schema extends z.ZodType<FieldValues, FieldValues>,
>(
  schema: Schema,
  options?: Omit<
    UseFormProps<z.input<Schema>, unknown, z.output<Schema>>,
    "resolver"
  >,
): UseFormReturn<z.input<Schema>, unknown, z.output<Schema>> =>
  useForm<z.input<Schema>, unknown, z.output<Schema>>({
    ...options,
    // The resolver names its values by the widest schema, so they are
    // narrowed back to this one's.
    resolver: zodResolver(schema) as unknown as Resolver<
      z.input<Schema>,
      unknown,
      z.output<Schema>
    >,
  });
