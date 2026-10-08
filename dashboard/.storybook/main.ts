import { isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import { mergeConfig, type Plugin } from "vite";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

// Stories run in the browser, where a Node builtin has no
// implementation. Vite stubs one silently unless a named import is
// used, so any import of a builtin from `src` is refused here.
const refuseBuiltins = (): Plugin => ({
  name: "refuse-node-builtins",
  enforce: "pre",
  resolveId(id, importer) {
    if (importer === undefined || !importer.startsWith(SRC)) return;
    if (!isBuiltin(id)) return;
    this.error(
      `${importer} imports the Node builtin "${id}", which a story cannot load in the browser`,
    );
  },
});

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  framework: "@storybook/react-vite",
  addons: ["@storybook/addon-vitest", "msw-storybook-addon"],
  // Holds the msw worker that answers the API calls a story makes.
  staticDirs: ["./public"],
  // The page colours come from the scheme tool in preview.tsx.
  features: { backgrounds: false },
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      plugins: [refuseBuiltins(), tailwindcss()],
    }),
};

export default config;
