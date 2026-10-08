import { createElement, type ComponentType } from "react";
import { hydrateRoot } from "react-dom/client";
import { PAGES } from "./components/pages/pages.js";
import { PAGE_DATA_ID, ROOT_ID, type PageData } from "./page-data.js";

// Runs in the browser: takes over the page the server drew, from what
// the server says it drew it from.
const root = document.getElementById(ROOT_ID);
const data = document.getElementById(PAGE_DATA_ID)?.textContent;
if (root === null || data === undefined || data === null) {
  throw new Error("the document names no page to take over");
}
const { name, props } = JSON.parse(data) as PageData;
hydrateRoot(
  root,
  createElement(PAGES[name] as ComponentType<object>, props),
);
