import type { ComponentProps } from "react";
import { HarnessPage } from "./HarnessPage/index.js";
import { HarnessesPage } from "./HarnessesPage/index.js";
import { HomePage } from "./HomePage/index.js";
import { RefusalPage } from "./RefusalPage/index.js";

// Every page by the name the server and the browser call it. A page's
// props travel as JSON between the two.
export const PAGES = {
  home: HomePage,
  harnesses: HarnessesPage,
  harness: HarnessPage,
  refusal: RefusalPage,
};

export type PageName = keyof typeof PAGES;

export type PageProps<Name extends PageName> = ComponentProps<
  (typeof PAGES)[Name]
>;
