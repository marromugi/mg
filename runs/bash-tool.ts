import { createBashTool } from "@mg/tools";

const usage = 'usage: node runs/bash-tool.ts "<command>"';
const [command, ...extra] = process.argv.slice(2);
if (command === undefined || extra.length > 0) {
  console.error(usage);
  process.exit(2);
}

const tool = createBashTool({ cwd: process.cwd() });
const prepared = await tool.prepare({ command });
console.log(await prepared.run({}));
