import { Controller, type UseFormReturn } from "react-hook-form";
import {
  Checkbox,
  Select,
  TextField,
  type Option,
} from "../../ui/index.js";
import type { HarnessValues } from "./schema.js";

type ModelPickerProps = {
  form: UseFormReturn<HarnessValues>;
  at: "model";
  label: string;
  options: readonly Option[];
  // Whether the model can only be typed, as when there is no list.
  typedOnly?: boolean;
};

// Chooses a model from a list, or takes one typed by hand once "set by
// hand" is ticked.
export const ModelPicker = ({
  form,
  at,
  label,
  options,
  typedOnly = false,
}: ModelPickerProps) => {
  const typed = typedOnly || form.watch(`${at}.custom`);
  const errors = form.formState.errors[at];

  return (
    <div className="flex flex-col gap-3">
      {typed ? (
        <TextField
          label={label}
          required
          hint="プロバイダーでのモデルの名前を、そのまま入力します。"
          error={errors?.typed?.message}
          {...form.register(`${at}.typed`)}
        />
      ) : (
        <Controller
          control={form.control}
          name={`${at}.listed`}
          render={({ field }) => (
            <Select
              name={field.name}
              label={label}
              required
              options={options}
              value={field.value}
              onChange={field.onChange}
              error={errors?.listed?.message}
            />
          )}
        />
      )}
      {typedOnly ? null : (
        <Controller
          control={form.control}
          name={`${at}.custom`}
          render={({ field }) => (
            <Checkbox
              label="カスタムで設定する"
              size="sm"
              checked={field.value}
              onChange={field.onChange}
            />
          )}
        />
      )}
    </div>
  );
};
