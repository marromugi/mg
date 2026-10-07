import { Icon, type IconSource, type Option } from "../../ui/index.js";
import {
  DeepSeekIcon,
  OllamaIcon,
  OpenAiIcon,
  OpenRouterIcon,
} from "./makers.js";
import type { HarnessValues } from "./schema.js";

type Model = { id: string; name: string; mark: IconSource };

// The models offered for each provider. Ollama runs whatever is on the
// machine, so it has no list and its model is typed by hand.
const MODELS: Record<HarnessValues["provider"], readonly Model[]> = {
  openrouter: [
    { id: "openai/gpt-4o", name: "GPT-4o", mark: OpenAiIcon },
    { id: "openai/gpt-4o-mini", name: "GPT-4o mini", mark: OpenAiIcon },
    {
      id: "deepseek/deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      mark: DeepSeekIcon,
    },
  ],
  ollama: [],
};

const marked = (mark: IconSource, name: string) => (
  <span className="flex items-center gap-2">
    <Icon icon={mark} />
    {name}
  </span>
);

export const providerOptions: Option[] = [
  {
    value: "openrouter",
    label: "OpenRouter",
    content: marked(OpenRouterIcon, "OpenRouter"),
  },
  {
    value: "ollama",
    label: "Ollama",
    content: marked(OllamaIcon, "Ollama"),
  },
];

export const modelOptions = (
  provider: HarnessValues["provider"],
): Option[] =>
  MODELS[provider].map((model) => ({
    value: model.id,
    label: model.name,
    content: marked(model.mark, model.name),
  }));
