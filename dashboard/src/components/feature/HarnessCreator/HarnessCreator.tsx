import { useId, useState, type ReactElement } from "react";
import { Controller, useFieldArray } from "react-hook-form";
import { useZodForm } from "../../../libs/hook-form/index.js";
import {
  Button,
  Checkbox,
  CloseIcon,
  Icon,
  IconButton,
  Modal,
  MultiCombobox,
  PlusIcon,
  ProgressBar,
  Select,
  ShieldIcon,
  TextArea,
  TextField,
} from "../../ui/index.js";
import { useCreation, type Creation } from "./hooks/useCreation.js";
import type { Outcome } from "./hooks/useOutcome.js";
import { useSteps, type StepId } from "./hooks/useSteps.js";
import { ModelPicker } from "./ModelPicker.js";
import { modelOptions, providerOptions } from "./models.js";
import {
  emptyValues,
  harnessSchema,
  type HarnessValues,
} from "./schema.js";
import { toolOptions } from "./tools.js";

type HarnessCreatorProps = {
  // The control that opens the steps; the focus goes back to it when
  // they close.
  trigger?: ReactElement<Record<string, unknown>>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Saves what was asked for when the last step is passed, and says how
  // it ended.
  onCreate: (creation: Creation) => Promise<Outcome>;
  initialValues?: HarnessValues;
  initialStep?: StepId;
};

// Asks for a new harness one step at a time. A step is checked before
// the next one opens, and the bar at the top shows how far along it is.
// It closes only by its own controls, so nothing typed is lost to a
// stray press; closed part-way, it opens again where it was left. Once a
// harness is saved it starts over. A save that is refused goes back to
// the first step with a problem; one that fails says why and keeps
// everything typed.
export const HarnessCreator = ({
  trigger,
  open,
  onOpenChange,
  onCreate,
  initialValues = emptyValues,
  initialStep = "name",
}: HarnessCreatorProps) => {
  const formId = useId();
  const form = useZodForm(harnessSchema, {
    defaultValues: initialValues,
  });
  const paths = useFieldArray({ control: form.control, name: "paths" });
  const { errors, isSubmitting } = form.formState;
  const [failure, setFailure] = useState<string>();

  const provider = form.watch("provider");
  const tools = form.watch("tools");
  const gate = form.watch("gate");

  const steps = useSteps(tools.length);
  const [stepId, setStepId] = useState<StepId>(initialStep);
  const found = steps.findIndex((step) => step.id === stepId);
  const index = found === -1 ? 0 : found;
  const step = steps[index];
  const last = index === steps.length - 1;
  if (step === undefined) return null;

  const back = () => {
    const before = steps[index - 1];
    if (before !== undefined) setStepId(before.id);
  };
  const next = async () => {
    if (!(await form.trigger([...step.fields]))) return;
    const after = steps[index + 1];
    if (after !== undefined) {
      setStepId(after.id);
      return;
    }
    await form.handleSubmit(async (values) => {
      setFailure(undefined);
      const outcome = await onCreate(useCreation(values));
      switch (outcome.kind) {
        case "saved":
          form.reset(initialValues);
          setStepId(initialStep);
          return;
        case "refused": {
          for (const { at, message } of outcome.fields) {
            form.setError(at, { message });
          }
          const asked = steps.find((candidate) =>
            outcome.fields.some(({ at }) =>
              candidate.fields.some(
                (field) => at === field || at.startsWith(`${field}.`),
              ),
            ),
          );
          if (asked !== undefined) setStepId(asked.id);
          if (outcome.others.length > 0) {
            setFailure(outcome.others.join(" "));
          }
          return;
        }
        case "failed":
          setFailure(`保存できませんでした。${outcome.reason}`);
      }
    })();
  };

  return (
    <Modal
      trigger={trigger}
      title="ハーネスを作る"
      dismiss="explicit"
      open={open}
      onOpenChange={onOpenChange}
      actions={
        <>
          {index === 0 ? null : (
            <Button type="button" onClick={back}>
              戻る
            </Button>
          )}
          <Button
            type="submit"
            form={formId}
            tone="primary"
            disabled={isSubmitting}
          >
            {last ? "作成する" : "次へ"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void next();
        }}
      >
        <div className="flex flex-col gap-2">
          <ProgressBar
            label="入力の進み具合"
            value={(index + 1) / steps.length}
          />
          <p className="text-xs opacity-70">
            {index + 1} / {steps.length}　{step.title}
          </p>
        </div>

        {failure === undefined ? null : (
          <p role="alert" className="text-xs text-error">
            {failure}
          </p>
        )}

        {step.id === "name" ? (
          <TextField
            label="ハーネス名"
            required
            hint="一覧で見分けるための名前です。"
            placeholder="files"
            autoFocus
            error={errors.name?.message}
            {...form.register("name")}
          />
        ) : null}

        {step.id === "model" ? (
          <div className="flex flex-col gap-4">
            <Controller
              control={form.control}
              name="provider"
              render={({ field }) => (
                <Select
                  name={field.name}
                  label="プロバイダー"
                  required
                  options={providerOptions}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            {provider === "ollama" ? (
              <TextField
                label="Ollama のアドレス"
                hint="省略できます。"
                placeholder="http://localhost:11434"
                {...form.register("baseUrl")}
              />
            ) : null}
            <ModelPicker
              form={form}
              at="model"
              label="モデル"
              options={modelOptions(provider)}
              typedOnly={provider === "ollama"}
            />
          </div>
        ) : null}

        {step.id === "tools" ? (
          <div className="flex flex-col gap-4">
            <Controller
              control={form.control}
              name="tools"
              render={({ field }) => (
                <MultiCombobox
                  name={field.name}
                  label="使えるツール"
                  hint="選ばなければ、ハーネスは会話だけをします。"
                  options={toolOptions}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            {tools.length > 0 ? (
              <TextField
                label="作業フォルダ"
                required
                hint="絶対パスで書きます。ファイルを扱うツールは、このフォルダの中だけを操作します。"
                placeholder="/Users/me/project"
                error={errors.root?.message}
                {...form.register("root")}
              />
            ) : null}
          </div>
        ) : null}

        {step.id === "security" ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold">許可するパス</p>
              <p className="text-xs opacity-70">
                作業フォルダからの相対パスで書きます。ここに書いた場所以外は、ファイルを扱うツールが使えなくなります。
              </p>
              <ul className="flex flex-col gap-2">
                {paths.fields.map((path, at) => (
                  <li key={path.id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <TextField
                        label={`許可するパス ${at + 1}`}
                        layout="bare"
                        size="md"
                        placeholder="src/**"
                        {...form.register(`paths.${at}.value`)}
                      />
                    </div>
                    <IconButton
                      icon={CloseIcon}
                      label="このパスを外す"
                      labelSide="left"
                      size="sm"
                      type="button"
                      onClick={() => paths.remove(at)}
                    />
                  </li>
                ))}
              </ul>
              <div>
                <Button
                  type="button"
                  size="sm"
                  icon={PlusIcon}
                  onClick={() => paths.append({ value: "" })}
                >
                  許可するパスを追加
                </Button>
              </div>
              {errors.paths?.root?.message === undefined &&
              errors.paths?.message === undefined ? null : (
                <p role="alert" className="text-xs text-error">
                  {errors.paths.root?.message ?? errors.paths.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold">ゲート</p>
              <p className="text-xs opacity-70">
                ツールを使うたびに、判定用のモデルが質問に答えます。答えが「はい」のときだけ、操作を通します。
              </p>
              <Controller
                control={form.control}
                name="gate"
                render={({ field }) => (
                  <Checkbox
                    label="ゲートを使う"
                    size="sm"
                    checked={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
              {gate ? (
                <>
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-semibold">
                      判定するモデル
                    </p>
                    <p className="flex items-center gap-2 text-sm">
                      <Icon icon={ShieldIcon} />
                      Jev
                      <span className="text-xs opacity-70">
                        Typesafe AI の判定用のモデルです。
                      </span>
                    </p>
                  </div>
                  <TextArea
                    label="判定の質問"
                    required
                    hint="「はい」と答えられる操作だけを通します。例: この操作は、作業フォルダの中だけを変更しますか。"
                    height="content"
                    error={errors.gateQuestion?.message}
                    {...form.register("gateQuestion")}
                  />
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {step.id === "other" ? (
          <TextField
            label="最大ターン数"
            required
            hint="LLM とのやり取りが、この回数に達したら止めます。"
            type="number"
            error={errors.maxTurns?.message}
            {...form.register("maxTurns")}
          />
        ) : null}
      </form>
    </Modal>
  );
};
