import type { Preview } from "@storybook/react-vite";
import { mswLoader } from "msw-storybook-addon/csf3";
import "../src/styles/tokens.css";
import "./preview.css";

// The scheme every colour token resolves by. "system" follows the
// device, as the app does.
const SCHEMES = { system: "", light: "light", dark: "dark" } as const;

const preview: Preview = {
  // A story answers the API with the handlers in its `msw` parameter.
  loaders: [mswLoader()],
  globalTypes: {
    scheme: {
      description: "配色",
      toolbar: {
        title: "配色",
        icon: "mirror",
        dynamicTitle: true,
        items: [
          { value: "system", title: "端末に合わせる" },
          { value: "light", title: "ライト" },
          { value: "dark", title: "ダーク" },
        ],
      },
    },
  },
  initialGlobals: { scheme: "system" },
  decorators: [
    (Story, context) => {
      const scheme = context.globals["scheme"] as keyof typeof SCHEMES;
      document.documentElement.style.colorScheme =
        SCHEMES[scheme] ?? "";
      return <Story />;
    },
  ],
};

export default preview;
