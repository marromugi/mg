// Builds the desktop app: `mg dashboard.app` under
// dashboard/app/src-tauri/target/release/bundle/macos/.
//
// The app carries a copy of Node and the server as one file, so it needs
// neither the repo's build output nor a Node on the PATH. The bundle sits
// at server/bin/ and the stylesheet and the browser script at dist/ inside the app's resources,
// the same two levels apart that src/routes/assets.ts expects.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

if (process.platform !== "darwin") {
  console.error("The desktop app is built on macOS only.");
  process.exit(1);
}

const appDir = dirname(fileURLToPath(import.meta.url));
const dashboardDir = dirname(appDir);
const tauriDir = join(appDir, "src-tauri");
const resourcesDir = join(tauriDir, "resources");
const binariesDir = join(tauriDir, "binaries");

const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, stdio: "inherit" });

const hostTriple = () => {
  const info = execFileSync("rustc", ["-vV"], { encoding: "utf-8" });
  const host = /^host: (\S+)$/m.exec(info);
  if (host === null) {
    throw new Error("rustc -vV printed no host triple");
  }
  return host[1];
};

// The run package reaches the browser and ssh connectors through
// @mg/workspace, and the trace, memory and conversation packages reach
// SQLite through libsql. The dashboard builds local tools and writes
// JSONL traces, so none of these is used. They cannot be bundled
// either (native addons, files read at run time). Each is replaced by
// a module that throws if it is ever used.
const unusableLibraries = {
  "playwright-core": ["chromium"],
  ssh2: ["Client"],
  "@libsql/client": ["createClient", "LibsqlError"],
};

const unusableInTheApp = {
  name: "unusable-in-the-app",
  setup(plugin) {
    plugin.onResolve(
      { filter: /^(playwright-core|ssh2|@libsql\/client)$/ },
      (args) => ({
        path: args.path,
        namespace: "unusable",
      }),
    );
    plugin.onLoad({ filter: /.*/, namespace: "unusable" }, (args) => ({
      loader: "js",
      contents: [
        `const unusable = () => new Proxy(function () {}, {`,
        `  get() { throw new Error("${args.path} is not part of the desktop app"); },`,
        `  apply() { throw new Error("${args.path} is not part of the desktop app"); },`,
        `  construct() { throw new Error("${args.path} is not part of the desktop app"); },`,
        `});`,
        ...unusableLibraries[args.path].map(
          (name) => `export const ${name} = unusable();`,
        ),
      ].join("\n"),
    }));
  },
};

run(
  "pnpm",
  ["--filter", "@mg/dashboard...", "run", "build"],
  dashboardDir,
);

rmSync(resourcesDir, { recursive: true, force: true });
rmSync(binariesDir, { recursive: true, force: true });
mkdirSync(join(resourcesDir, "server", "bin"), { recursive: true });
mkdirSync(join(resourcesDir, "dist"), { recursive: true });
mkdirSync(binariesDir, { recursive: true });

await build({
  entryPoints: [join(dashboardDir, "dist", "server.js")],
  outfile: join(
    resourcesDir,
    "server",
    "bin",
    "mg-dashboard-server.mjs",
  ),
  bundle: true,
  platform: "node",
  format: "esm",
  // Packages that are still CommonJS call require() on Node's own modules.
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  plugins: [unusableInTheApp],
  logLevel: "warning",
});

for (const asset of ["styles.css", "browser.js"]) {
  copyFileSync(
    join(dashboardDir, "dist", asset),
    join(resourcesDir, "dist", asset),
  );
}
copyFileSync(
  process.execPath,
  join(binariesDir, `node-${hostTriple()}`),
);

run("pnpm", ["exec", "tauri", "build", "--bundles", "app"], appDir);
console.log(
  `Built ${join(tauriDir, "target", "release", "bundle", "macos", "mg dashboard.app")}`,
);
