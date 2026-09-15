import type { Preview } from "@storybook/react-vite";
import "../src/styles/tokens.css";

const colorScheme: Record<string, string> = {
  system: "light dark",
  light: "light",
  dark: "dark",
};

const preview: Preview = {
  globalTypes: {
    scheme: {
      description: "Color scheme",
      toolbar: {
        title: "Scheme",
        items: [
          { value: "system", title: "System" },
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    scheme: "system",
  },
  decorators: [
    (Story, context) => {
      if (typeof document !== "undefined") {
        document.documentElement.style.colorScheme =
          colorScheme[context.globals.scheme as string];
      }
      return <Story />;
    },
  ],
};

export default preview;
