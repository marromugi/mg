import { readFile, writeFile } from "node:fs/promises";
import { defineConfig } from "orval";
import { apiDocument } from "./src/api/document.js";

// Orval leaves the extension off the import the mock file makes, which
// this package's module setting does not resolve.
const nameExtensions = async (files: string[]): Promise<void> => {
  for (const file of files) {
    const text = await readFile(file, "utf8");
    await writeFile(
      file,
      text.replaceAll(/from '(\.\/[^']+?)(?<!\.js)'/g, "from '$1.js'"),
    );
  }
};

// Generates the hooks the components call and the msw handlers the
// stories answer with, from the routes in `src/api`.
export default defineConfig({
  dashboard: {
    input: { target: apiDocument() },
    output: {
      target: "src/api-client/generated/api.ts",
      mode: "split",
      client: "react-query",
      httpClient: "fetch",
      baseUrl: "/api",
      // Named here because the package's own tsconfig takes it from the
      // one it extends, which Orval does not follow.
      tsconfig: { compilerOptions: { module: "NodeNext" } },
      mock: {
        generators: [{ type: "msw", generateEachHttpStatus: true }],
      },
      clean: true,
    },
    hooks: {
      afterAllFilesWrite: [nameExtensions, "prettier --write"],
    },
  },
});
