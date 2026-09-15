/// <reference types="vite/client" />
import { composeStories } from "@storybook/react";
import type { ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

const storyModules = import.meta.glob("./**/*.stories.tsx", {
  eager: true,
});

const files = Object.keys(storyModules);

describe("story snapshots", () => {
  it("finds story files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const csfExports = storyModules[file] as Parameters<
      typeof composeStories
    >[0];
    const stories = composeStories(csfExports);
    const entries = Object.entries(stories) as [
      string,
      ComponentType,
    ][];

    it(`${file} has at least one story`, () => {
      expect(entries.length).toBeGreaterThan(0);
    });

    for (const [storyName, Story] of entries) {
      it(`${file} ${storyName}`, () => {
        const html = renderToString(<Story />).replace(
          /<style>[\s\S]*?<\/style>/g,
          "<style></style>",
        );

        expect(html).toMatchSnapshot(`${file} ${storyName}`);
      });
    }
  }
});
