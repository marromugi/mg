import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { mergeConfig } from "vite";

const nodeFsShim = fileURLToPath(
  new URL("./shims/node-fs.ts", import.meta.url),
);

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  framework: "@storybook/react-vite",
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      plugins: [tailwindcss()],
      resolve: { alias: { "node:fs": nodeFsShim } },
    }),
};

export default config;
