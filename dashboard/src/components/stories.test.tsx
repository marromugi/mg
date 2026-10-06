/// <reference types="vite/client" />
import { composeStories } from "@storybook/react";
import type { ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

const storyModules = import.meta.glob("./**/*.stories.tsx", {
  eager: true,
});

describe("story snapshots", () => {
  for (const [file, module] of Object.entries(storyModules)) {
    const stories = composeStories(
      module as Parameters<typeof composeStories>[0],
    );

    for (const [name, Story] of Object.entries(stories)) {
      it(`${file} ${name}`, () => {
        const Component = Story as ComponentType;
        expect(renderToString(<Component />)).toMatchSnapshot();
      });
    }
  }
});
