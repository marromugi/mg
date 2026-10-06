import { createServer } from "node:http";
import {
  createCredentialAccess,
  createKeychainStore,
} from "@mg/credentials";
import {
  createCdpConnector,
  defineWorkspace,
  openWorkspace,
} from "@mg/workspace";

const PORT = 8787;

const page = (body: string): string =>
  `<!doctype html><title>Sign in</title>${body}`;

const server = createServer((request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  if (request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const form = new URLSearchParams(body);
      response.end(
        page(
          `<h1>Signed in</h1><p>user: ${form.get("user")}</p>` +
            `<p>password: ${form.get("password")}</p>`,
        ),
      );
    });
    return;
  }
  response.end(
    page(
      `<form method="post" action="/welcome">` +
        `<label>User name <input name="user"></label>` +
        `<label>Password <input name="password" type="password"></label>` +
        `<button>Sign in</button></form>`,
    ),
  );
});
await new Promise<void>((resolve) =>
  server.listen(PORT, "127.0.0.1", resolve),
);

const workspace = await openWorkspace(
  defineWorkspace({
    name: "local-browser",
    connectors: [
      createCdpConnector({
        browser: "localhost:9222",
        url: "http://localhost:9222",
        credentials: createCredentialAccess({
          store: createKeychainStore({ service: "mg" }),
          entries: [
            {
              name: "demo",
              origins: [`http://127.0.0.1:${PORT}`],
              fields: ["username", "password"],
            },
          ],
          approval: { needed: false },
        }),
      }),
    ],
  }),
);

const call = async (name: string, input: object): Promise<string> => {
  const tool = workspace.tools.find((t) => t.name === name);
  if (tool === undefined) throw new Error(`tool not found: ${name}`);
  const prepared = await tool.prepare(input);
  return await prepared.run({});
};

const show = async (name: string, input: object): Promise<void> => {
  console.log(`> ${name} ${JSON.stringify(input)}`);
  try {
    console.log(await call(name, input));
  } catch (error) {
    console.log(
      `refused: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const fillUser = {
  role: "textbox",
  name: "User name",
  credential: "demo",
  field: "username",
};
const fillPassword = {
  role: "textbox",
  name: "Password",
  credential: "demo",
  field: "password",
  submit: true,
};

try {
  await show("browser_navigate", { url: `http://127.0.0.1:${PORT}/` });
  await show("browser_credentials", {});
  await show("browser_fill_credential", fillUser);
  await show("browser_fill_credential", fillPassword);
  await show("browser_read", {});

  await show("browser_navigate", { url: `http://localhost:${PORT}/` });
  await show("browser_credentials", {});
  await show("browser_fill_credential", fillUser);
} finally {
  await workspace.close();
  server.close();
}
