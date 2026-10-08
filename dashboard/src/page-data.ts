import type { PageName } from "./components/pages/pages.js";

// Where the server puts a page in the document, and where it puts what
// the browser needs to draw the same page again: which one, and what it
// was given.
export const ROOT_ID = "root";
export const PAGE_DATA_ID = "page";

export type PageData = { name: PageName; props: object };
