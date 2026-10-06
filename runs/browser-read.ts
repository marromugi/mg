import {
  createCdpConnector,
  defineWorkspace,
  openWorkspace,
} from "@mg/workspace";

const usage = 'usage: node runs/browser-read.ts "<url>"';
const [url, ...extra] = process.argv.slice(2);
if (url === undefined || extra.length > 0) {
  console.error(usage);
  process.exit(2);
}

const workspace = await openWorkspace(
  defineWorkspace({
    name: "local-browser",
    connectors: [
      createCdpConnector({
        browser: "localhost:9222",
        url: "http://localhost:9222",
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

try {
  console.log(await call("browser_navigate", { url }));
  console.log(await call("browser_read", {}));
} finally {
  await workspace.close();
}
