// SPIKE (#907): put build, build-storybook, lint and test of every package into ONE `vp run` graph.
// Each package gets g* twins of its lint/test/build-storybook tasks that wait for their dependencies'
// `build` (turbo's `^build`); the root `verify-graph` task depends on all of them. Idempotent.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const DEP = `dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }]`;
const ENV = [
  "PUBLISHED_BASE_DOMAIN",
  "STORAGE_S3_BUCKET",
  "STORAGE_S3_ENDPOINT",
  "STORAGE_S3_REGION",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "RUN_TERRAFORM",
];
const SPECIAL_TEST_CACHE = {
  "packages/cli": `cache: { env: ${JSON.stringify(ENV)} }`,
  "packages/db-sqlite": `cache: { env: ${JSON.stringify(ENV.slice(0, 6))} }`,
  "apps/dev-server": `cache: { input: [{ auto: true }, "!.vitest/**", "!.gitignore"] }`,
};
const STORYBOOK = `cache: { input: [{ auto: true }, "!storybook-static/**"], output: ["storybook-static/**"] }`;

const dirs = [
  ...readdirSync("packages").map((d) => `packages/${d}`),
  "apps/fly-app",
  "apps/dev-server",
];
const names = [];
for (const dir of dirs) {
  const cfgPath = `${dir}/vite.config.ts`;
  let cfg;
  try {
    cfg = readFileSync(cfgPath, "utf8");
  } catch {
    continue;
  }
  if (cfg.includes("glint:")) continue;
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
  const scripts = pkg.scripts ?? {};
  const tasks = [];
  if (scripts.lint) tasks.push(`glint: { command: ${JSON.stringify(scripts.lint)}, ${DEP} }`);
  const test = scripts.test ?? (SPECIAL_TEST_CACHE[dir] ? "vp test run" : null);
  if (test)
    tasks.push(
      `gtest: { command: ${JSON.stringify(test)}, ${SPECIAL_TEST_CACHE[dir] ?? ""}${SPECIAL_TEST_CACHE[dir] ? "," : ""} ${DEP} }`,
    );
  if (dir === "packages/app")
    tasks.push(
      `gstorybook: { command: "storybook build -o storybook-static --stats-json", ${STORYBOOK}, ${DEP} }`,
    );
  names.push([
    pkg.name,
    [
      "build",
      ...(scripts.lint ? ["glint"] : []),
      ...(test ? ["gtest"] : []),
      ...(dir === "packages/app" ? ["gstorybook"] : []),
    ],
  ]);
  const block = tasks.join(",\n      ") + ",";
  if (cfg.includes("tasks: {")) cfg = cfg.replace("tasks: {", `tasks: {\n      ${block}`);
  else
    cfg = cfg.replace(
      "defineConfig({",
      `defineConfig({\n  run: { tasks: {\n      ${block}\n  } },`,
    );
  writeFileSync(cfgPath, cfg);
}
const deps = names.flatMap(([n, ts]) => ts.map((t) => `${n}#${t}`));
let root = readFileSync("vite.config.ts", "utf8");
if (!root.includes('"verify-graph"')) {
  root = root.replace(
    "tasks: {",
    `tasks: {\n      "verify-graph": { command: "true", cache: false, dependsOn: ${JSON.stringify(deps)} },`,
  );
  writeFileSync("vite.config.ts", root);
}
process.stdout.write(`${deps.length} graph nodes\n`);
