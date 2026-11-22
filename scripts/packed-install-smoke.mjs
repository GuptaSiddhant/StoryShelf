#!/usr/bin/env node
// oxlint-disable max-statements curly no-console
/**
 * Install StoryShelf the way a user does, from real `npm pack` tarballs, and run it (#393 launch slice).
 *
 * Unit and smoke tests link workspace packages by hand, which hid a missing dependency
 * in the default scaffold (#1137). This script has no workspace links at all:
 *
 *  1. pack every public package (manifests rewritten as the release does, then restored),
 *     and check each archive holds every export and bin target (#1265),
 *     and that `@storyshelf/app/node` imports from the installed scaffold with no side effects (#394),
 *     and that a hosting-only install of the app holds none of axe-core, pngjs and pixelmatch (#1335),
 *  2. install the CLI, `create-storyshelf` and `@storyshelf/mcp` from their tarballs, each in its own
 *     empty directory outside this checkout; `create-storyshelf` must install with no dependency at all,
 *  3. run `npm create storyshelf` (`npm exec` on the tarball; answers: all defaults, so local accounts),
 *     and `storyshelf-mcp init`,
 *  4. `npm install` the scaffold, with every @storyshelf/* dependency (direct or transitive)
 *     resolved to a tarball instead of the registry; the install must hold exactly one
 *     `@storyshelf/core` (a peer of the adapters),
 *  5. `npm start`, sign in, create a project and a token, and `storyshelf upload` a built Storybook,
 *  6. wait for the build to finish and fail unless it passed.
 *
 * Needs a built workspace (`nubx turbo run build --filter='!website'`) and a built Storybook.
 *
 * Usage: node scripts/packed-install-smoke.mjs [--storybook <dir>] [--keep]
 *   --storybook  a Storybook project dir holding .storybook/ and storybook-static/ (default fixtures/storybook-9)
 *   --keep       keep the scratch directory
 */
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { findInstalled } from "./installed-packages.mjs";
import { getPublishOrder, packagesDir } from "./publish-order.mjs";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const storybookArg = args.indexOf("--storybook");
const storybookDir = resolve(
  storybookArg === -1 ? join(root, "fixtures/storybook-9") : (args[storybookArg + 1] ?? ""),
);
const ADMIN_TOKEN = "packed-smoke-admin-token";
const PASSWORD = "packed-smoke-password";
const PROJECT_NAME = "packed-smoke";
const SECRET = "packed-smoke-secret-packed-smoke-secret";

function log(message) {
  console.log(`\n[packed-smoke] ${message}`);
}

/** Fail the run: thrown so `main` still stops the server and cleans up. */
function fail(message) {
  throw new Error(message);
}

/** Run a command to completion, inheriting nothing; fail with its output unless it exits 0. `merge` returns stderr too. */
function run(command, argv, { merge = false, ...options } = {}) {
  const result = spawnSync(command, argv, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    fail(
      `\`${command} ${argv.join(" ")}\` exited ${result.status}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return merge ? `${result.stdout}\n${result.stderr}` : result.stdout;
}

/** A scaffold's `npm install` must print no `ERESOLVE` or `npm warn` line (#1236): a first install must look clean. */
function assertCleanInstall(output) {
  const noisy = output.split("\n").filter((line) => /ERESOLVE|npm warn/u.test(line));
  if (noisy.length > 0) {
    fail(`npm install of the scaffold printed warnings:\n${noisy.join("\n")}`);
  }
}

/** Pack every public package into `dest`; the manifests are restored afterwards. Returns name → tarball path. */
function packAll(dest) {
  const dirs = getPublishOrder();
  const originals = new Map(
    dirs.map((dir) => {
      const file = join(packagesDir, dir, "package.json");
      return [file, readFileSync(file, "utf8")];
    }),
  );
  const tarballs = {};
  try {
    // The release publishes after this same rewrite: npm cannot record `workspace:` or `catalog:`.
    run("node", [join(root, "scripts/rewrite-workspace-protocol.mjs")]);
    // ...and with the dist-only exports written into the manifest (no `source` condition ships, #1265).
    run("node", [join(root, "scripts/materialize-exports.mjs")]);
    for (const dir of dirs) {
      const cwd = join(packagesDir, dir);
      const name = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).name;
      const out = run("npm", ["pack", "--pack-destination", dest, "--silent"], { cwd }).trim();
      tarballs[name] = join(dest, out.split("\n").at(-1));
    }
  } finally {
    for (const [file, content] of originals) {
      // Same-directory temp file, then rename: an interrupted restore never leaves a partial manifest.
      writeFileSync(`${file}.restore`, content);
      renameSync(`${file}.restore`, file);
    }
  }
  return tarballs;
}

/** Fail unless every packed archive holds its export and bin targets, with no `source` condition or map (#1265). */
function assertArchives(tarballs) {
  const output = run(
    "node",
    [join(root, "scripts/check-packed-archives.mjs"), ...Object.values(tarballs)],
    {
      merge: true,
    },
  );
  console.log(output.trim().split("\n").slice(-20).join("\n"));
}

/**
 * `@storyshelf/app/node` resolves from the installed tarball and is pure at import (#394): no
 * signal handler and nothing keeping the process alive, so the probe exits by itself.
 */
function assertNodeHost(project) {
  const probe = [
    'const before = process.listenerCount("SIGTERM") + process.listenerCount("SIGINT");',
    'const host = await import("@storyshelf/app/node");',
    'if (typeof host.startServer !== "function") throw new Error("no startServer export");',
    'if (process.listenerCount("SIGTERM") + process.listenerCount("SIGINT") !== before) throw new Error("signal handlers at import");',
  ].join("\n");
  run(process.execPath, ["--input-type=module", "-e", probe], { cwd: project, timeout: 30_000 });
  log("@storyshelf/app/node resolves from the tarball, with no side effects at import");
}

/** A free TCP port. */
function freePort() {
  return new Promise((done, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

/** Collect a child's output, and call `onData` after each chunk. */
function collect(child, onData) {
  const state = { text: "" };
  const listen = (chunk) => {
    state.text += chunk.toString();
    onData?.(state);
  };
  child.stdout.on("data", listen);
  child.stderr.on("data", listen);
  return state;
}

/**
 * Answer an interactive scaffold with its defaults: Enter whenever the prompt has been quiet
 * for a moment (the prompts library redraws with escape codes, so lines cannot be counted).
 * The scaffold lands in `./my-storyshelf` of `cwd`. Resolves when the command exits, once `done` shows in
 * its output (the last line of the next steps: it may linger on stdin).
 */
function answerWithDefaults(command, argv, cwd, done) {
  return new Promise((finish) => {
    const child = spawn(command, argv, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let idle;
    const output = collect(child, (state) => {
      clearTimeout(idle);
      if (state.text.includes(done)) {
        child.stdin.end();
        setTimeout(() => child.kill("SIGTERM"), 1000);
        return;
      }
      idle = setTimeout(() => child.stdin.write("\n"), 400);
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("exit", (code) => {
      clearTimeout(idle);
      clearTimeout(timeout);
      finish({ code, output: output.text });
    });
  });
}

/** `overrides` that resolve every packed @storyshelf/* package, wherever it is required, to its tarball. */
function tarballOverrides(tarballs) {
  return Object.fromEntries(Object.entries(tarballs).map(([name, file]) => [name, `file:${file}`]));
}

/** Point every @storyshelf/* dependency at its tarball, transitive ones through `overrides`. */
function useTarballs(projectDir, tarballs) {
  const file = join(projectDir, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  const overrides = tarballOverrides(tarballs);
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    if (name in overrides) {
      pkg.dependencies[name] = overrides[name];
    }
  }
  pkg.overrides = overrides;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  return pkg;
}

/** True when `url` answers 2xx. */
async function answers(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function waitForOk(url, server, timeoutMs, state) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      fail(`server exited early with code ${server.exitCode}\n${state.text}`);
    }
    // oxlint-disable-next-line no-await-in-loop -- poll until the server answers
    if (await answers(url)) {
      return;
    }
    // oxlint-disable-next-line no-await-in-loop -- poll interval
    await sleep(300);
  }
  fail(`no answer from ${url} within ${timeoutMs} ms\n${state.text}`);
}

/**
 * `@storyshelf/storage` installed from its tarball with only the S3 SDK (#1294): no Google or Azure
 * SDK may land in `node_modules`, and `/s3` must import and build an adapter from that install.
 */
function assertS3OnlyInstall(scratch, tarballs) {
  const dir = join(scratch, "s3-only");
  mkdirSync(dir);
  const manifest = {
    name: "s3-only",
    private: true,
    type: "module",
    dependencies: {
      "@storyshelf/storage": `file:${tarballs["@storyshelf/storage"]}`,
      "@aws-sdk/client-s3": "^3.700.0",
      "@aws-sdk/lib-storage": "3.700.0",
    },
    overrides: tarballOverrides(tarballs),
  };
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  log("installing @storyshelf/storage with only the S3 SDK");
  run("npm", ["install", "--no-audit", "--no-fund"], { cwd: dir });
  for (const absent of ["@google-cloud/storage", "@azure/storage-blob", "@azure/identity"]) {
    if (existsSync(join(dir, "node_modules", absent))) {
      fail(`an S3-only install of @storyshelf/storage pulled in ${absent}`);
    }
  }
  const check = [
    'const { createS3Storage } = await import("@storyshelf/storage/s3");',
    'const { createLocalStorage } = await import("@storyshelf/storage/local");',
    'const s3 = createS3Storage({ bucket: "b", endpoint: "http://127.0.0.1:1", region: "us-east-1" });',
    'if (s3.metadata.kind !== "s3" || typeof createLocalStorage !== "function") throw new Error("bad exports");',
    "await s3.lifecycle?.teardown?.();",
  ].join("\n");
  run(process.execPath, ["--input-type=module", "-e", check], { cwd: dir });
}

/**
 * `@storyshelf/app` installed from its tarball with no runner (#1335): a hosting-only install must hold no
 * `axe-core`, `pngjs` or `pixelmatch` (the runner brings them), yet import the app and `./diff`. Logs the install size.
 */
function assertHostingOnlyInstall(scratch, tarballs) {
  const dir = join(scratch, "hosting-only");
  mkdirSync(dir);
  const manifest = {
    name: "hosting-only",
    private: true,
    type: "module",
    dependencies: { "@storyshelf/app": `file:${tarballs["@storyshelf/app"]}` },
    overrides: tarballOverrides(tarballs),
  };
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  log("installing @storyshelf/app without the runner (hosting only)");
  run("npm", ["install", "--no-audit", "--no-fund"], { cwd: dir });
  for (const absent of [
    "axe-core",
    "pngjs",
    "pixelmatch",
    "@storyshelf/runner",
    "playwright-core",
  ]) {
    if (existsSync(join(dir, "node_modules", absent))) {
      fail(`a hosting-only install of @storyshelf/app pulled in ${absent}`);
    }
  }
  const check = [
    'await import("@storyshelf/app");',
    'const diff = await import("@storyshelf/core/diff");',
    'if (typeof diff.diffImagesAsync !== "function") throw new Error("bad exports");',
  ].join("\n");
  run(process.execPath, ["--input-type=module", "-e", check], { cwd: dir });
  const size = run("du", ["-sk", join(dir, "node_modules")]).split("\t")[0];
  log(`hosting-only install: node_modules is ${size} KB, with none of axe-core, pngjs, pixelmatch`);
}

/** A clean directory holding only `name` installed from its tarball; returns the directory. */
function installAlone(scratch, name, tarballs, directory) {
  const dir = join(scratch, directory);
  mkdirSync(dir);
  const manifest = {
    name: directory,
    private: true,
    dependencies: { [name]: `file:${tarballs[name]}` },
    // The package's own @storyshelf/* dependencies must come from tarballs too, not the registry.
    overrides: tarballOverrides(tarballs),
  };
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  log(`installing ${name} from its tarball`);
  run("npm", ["install", "--no-audit", "--no-fund"], { cwd: dir });
  return dir;
}

/** `create-storyshelf` ships one file with no dependency: its install adds nothing but itself. */
function assertNoDependencies(tarballs, dir) {
  const pack = JSON.parse(
    run("tar", ["-xOf", tarballs["create-storyshelf"], "package/package.json"]),
  );
  if (Object.keys(pack.dependencies ?? {}).length > 0) {
    fail(`create-storyshelf declares dependencies: ${Object.keys(pack.dependencies).join(", ")}`);
  }
  const installed = readdirSync(join(dir, "node_modules")).filter((name) => !name.startsWith("."));
  if (installed.join() !== "create-storyshelf") {
    fail(`create-storyshelf installed more than itself: ${installed.join(", ")}`);
  }
  log("create-storyshelf installs with no dependency");
}

/**
 * `@storyshelf/common` installed alone (#1334): its manifest and its install hold `@opentelemetry/api` and
 * nothing else, no `@storyshelf/*` package among them, and every subpath imports from that install.
 */
function assertCommonAlone(scratch, tarballs) {
  const pack = JSON.parse(
    run("tar", ["-xOf", tarballs["@storyshelf/common"], "package/package.json"]),
  );
  const declared = Object.keys(pack.dependencies ?? {}).join();
  if (declared !== "@opentelemetry/api") {
    fail(`@storyshelf/common declares dependencies other than @opentelemetry/api: ${declared}`);
  }
  const dir = installAlone(scratch, "@storyshelf/common", tarballs, "common-alone");
  const installed = readdirSync(join(dir, "node_modules")).filter((name) => !name.startsWith("."));
  if (installed.toSorted().join() !== "@opentelemetry,@storyshelf") {
    fail(
      `@storyshelf/common installed more than itself and the OpenTelemetry API: ${installed.join(", ")}`,
    );
  }
  const scopes = readdirSync(join(dir, "node_modules/@storyshelf")).join();
  if (scopes !== "common") {
    fail(`@storyshelf/common pulled in another @storyshelf package: ${scopes}`);
  }
  const subpaths = Object.keys(pack.exports ?? {}).filter((key) => key !== "./package.json");
  const check = subpaths
    .map((key) => `await import("@storyshelf/common/${key.slice(2)}");`)
    .join("\n");
  run(process.execPath, ["--input-type=module", "-e", check], { cwd: dir });
  log(`@storyshelf/common installs alone and ${subpaths.length} subpaths import`);
}

/**
 * `@storyshelf/mcp` and `@storyshelf/observability` depend on `@storyshelf/common`, not core (#1334): their
 * installs hold no core, Drizzle or pino, and each entry that needs no server stack imports from that install.
 */
function assertNoServerStack(scratch, tarballs) {
  for (const [name, entries] of [
    ["@storyshelf/mcp", ["@storyshelf/mcp/http"]],
    ["@storyshelf/observability", ["@storyshelf/observability", "@storyshelf/observability/node"]],
  ]) {
    const dir = installAlone(scratch, name, tarballs, `isolated-${name.split("/")[1]}`);
    const present = findInstalled(dir, ["@storyshelf/core", "drizzle-orm", "pino"]);
    if (present.length > 0) {
      fail(`installing ${name} pulled in ${present.join(", ")}`);
    }
    const check = entries.map((entry) => `await import("${entry}");`).join("\n");
    run(process.execPath, ["--input-type=module", "-e", check], { cwd: dir });
    const size = run("du", ["-sk", join(dir, "node_modules")]).split("\t")[0];
    log(`${name} installs with no core, drizzle-orm or pino (node_modules ${size} KB)`);
  }
}

/** `storyshelf-mcp` answers `--help` with its subcommands, and `init` scaffolds a project from defaults. */
async function assertMcpBin(scratch, tarballs) {
  const dir = installAlone(scratch, "@storyshelf/mcp", tarballs, "mcp-tool");
  const bin = join(dir, "node_modules/@storyshelf/mcp/dist/index.js");
  const help = run(process.execPath, [bin, "--help"]);
  for (const word of ["init", "serve", "--http"]) {
    if (!help.includes(word)) fail(`storyshelf-mcp --help does not mention ${word}\n${help}`);
  }
  const work = join(scratch, "mcp-work");
  mkdirSync(work);
  const result = await answerWithDefaults(process.execPath, [bin, "init"], work, "mcp serve");
  if (!existsSync(join(work, "my-storyshelf", ".mcp.json"))) {
    fail(`storyshelf-mcp init failed (exit ${result.code})\n${result.output}`);
  }
  log("storyshelf-mcp init scaffolds a project from the tarball");
}

/** Every `node_modules/@storyshelf/core` directory under `dir`, at any depth. */
function installedCores(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === ".bin") continue;
      const path = join(current, entry.name);
      if (entry.name === "core" && current.endsWith(join("node_modules", "@storyshelf"))) {
        found.push(path);
      } else {
        walk(path);
      }
    }
  };
  walk(join(dir, "node_modules"));
  return found;
}

/** Core is a peer of the adapters (#1332): the scaffold's install holds exactly one copy of it. */
function assertOneCore(project) {
  const cores = installedCores(project);
  if (cores.length !== 1 || cores[0] !== join(project, "node_modules/@storyshelf/core")) {
    fail(
      `expected exactly one top-level @storyshelf/core, found:\n${cores.join("\n") || "(none)"}`,
    );
  }
  log("the scaffold's install holds exactly one @storyshelf/core");
}

/** The CLI and `create-storyshelf` installed from their tarballs, and the scaffold installed from the tarballs. */
async function installFromTarballs(scratch, tarballs) {
  const tool = installAlone(scratch, "storyshelf", tarballs, "tool");
  const cli = join(tool, "node_modules/storyshelf/dist/index.js");
  const creator = installAlone(scratch, "create-storyshelf", tarballs, "creator");
  assertNoDependencies(tarballs, creator);
  await assertMcpBin(scratch, tarballs);

  const project = join(scratch, "my-storyshelf");
  log("npm create storyshelf (all defaults)");
  // What `npm create storyshelf` runs: the `create-storyshelf` bin of the package, here from its tarball.
  const init = await answerWithDefaults(
    "npm",
    ["exec", "--yes", `--package=file:${tarballs["create-storyshelf"]}`, "--", "create-storyshelf"],
    scratch,
    "npm start",
  );
  if (!init.output.includes("Scaffolded") || !existsSync(join(project, "package.json"))) {
    fail(`create-storyshelf failed (exit ${init.code})\n${init.output}`);
  }
  const pkg = useTarballs(project, tarballs);
  log(`scaffold depends on: ${Object.keys(pkg.dependencies).join(", ")}`);
  assertCleanInstall(
    run("npm", ["install", "--no-audit", "--no-fund"], { cwd: project, merge: true }),
  );
  assertNodeHost(project);
  assertOneCore(project);
  return { cli, project };
}

/** Stop `npm start` and the node process under it (its own process group), and wait for them to exit. */
async function stopServer(child) {
  const exited = new Promise((done) => {
    if (child.exitCode === null) {
      child.once("exit", done);
    } else {
      done();
    }
  });
  signalGroup(child, "SIGTERM");
  await Promise.race([exited, sleep(5000)]);
  // `npm` may be gone while a descendant lingers or ignores SIGTERM: whatever is left in the group is killed.
  signalGroup(child, "SIGKILL");
}

/** Signal the child's whole process group; a group that is already gone is not an error. */
function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    // ESRCH: no member left
  }
}

/** `npm start` in the scaffold; resolves once the health endpoint answers. */
async function startServer(project) {
  const port = await freePort();
  log(`npm start on :${port}`);
  const child = spawn("npm", ["start"], {
    cwd: project,
    env: {
      ...process.env,
      PORT: String(port),
      SHELF_DATA_DIR: join(project, "data"),
      SHELF_SECRET: SECRET,
      // The default scaffold uses local accounts, which need all three variables.
      SHELF_PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      SHELF_ADMIN_PASSWORD: PASSWORD,
      SHELF_ADMIN_TOKEN: ADMIN_TOKEN,
    },
    // Its own process group, so stopping it also stops the node process `npm start` runs.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = collect(child);
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForOk(`${url}/api/v1/health`, child, 60_000, output);
  } catch (error) {
    // `main` has no handle on the server yet, so stop its process group here before rethrowing.
    await stopServer(child);
    throw error;
  }
  return { child, url, output };
}

/** A copy of the Storybook project, so `create` writes its config into scratch and not the fixture. */
function copyStorybook(scratch) {
  const sb = join(scratch, "storybook");
  mkdirSync(sb);
  for (const name of [".storybook", "storybook-static", "package.json"]) {
    cpSync(join(storybookDir, name), join(sb, name), { recursive: true });
  }
  rmSync(join(sb, ".storybook/storyshelf.json"), { force: true });
  return sb;
}

/** A signed-in request to the server: the cookie jar of one sign-in, with the portal origin a write needs. */
async function signedIn(url) {
  const origin = new URL(url).origin;
  const response = await fetch(`${url}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email: "admin@example.com", password: PASSWORD }),
  });
  if (!response.ok) {
    fail(`sign-in failed (${response.status})\n${await response.text()}`);
  }
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  return async (path, body) => {
    const answer = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie },
      body: JSON.stringify(body),
    });
    if (!answer.ok) {
      fail(`POST ${path} failed (${answer.status})\n${await answer.text()}`);
    }
    return await answer.json();
  };
}

/**
 * Sign in, make a project and a token (what the UI's "Get your first build" card does), then `upload`,
 * as the getting-started guide says. `create --token` is not used: with sign-in on, the token it
 * mints has no owner and so is a viewer.
 */
async function createAndUpload(cli, url, sb) {
  log("sign in, create a project and a token");
  const post = await signedIn(url);
  await post("/api/v1/projects", { name: PROJECT_NAME });
  const ciToken = (await post(`/api/v1/projects/${PROJECT_NAME}/tokens`, { name: "ci" })).token;
  if (!ciToken) {
    fail("the token call returned no token");
  }
  log("storyshelf upload");
  const uploadArgs = [
    "--url",
    url,
    "--slug",
    PROJECT_NAME,
    "--build-dir",
    "storybook-static",
    "--branch",
    "main",
    "--sha",
    "abc1234",
  ];
  const uploaded = run(process.execPath, [cli, "upload", ...uploadArgs], {
    cwd: sb,
    env: { ...process.env, SHELF_TOKEN: ciToken },
  });
  console.log(uploaded);
  return ciToken;
}

async function main() {
  if (!existsSync(join(storybookDir, "storybook-static/index.json"))) {
    fail(`no built Storybook in ${storybookDir}/storybook-static (build it first)`);
  }
  // Outside this checkout, so no ancestor node_modules can satisfy a missing dependency.
  const scratch = mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "packed-smoke-"));
  let server;
  try {
    log(`scratch directory ${scratch}`);
    const tarDir = join(scratch, "tarballs");
    mkdirSync(tarDir);
    log("packing every public package");
    const tarballs = packAll(tarDir);
    log(`packed ${Object.keys(tarballs).length} packages`);
    assertArchives(tarballs);
    assertS3OnlyInstall(scratch, tarballs);
    assertCommonAlone(scratch, tarballs);
    assertNoServerStack(scratch, tarballs);
    assertHostingOnlyInstall(scratch, tarballs);
    const { cli, project } = await installFromTarballs(scratch, tarballs);
    server = await startServer(project);
    const ciToken = await createAndUpload(cli, server.url, copyStorybook(scratch));
    await assertBuildPassed(server.url, ciToken);
    log("ok: packed install, scaffold, start, create, upload and one passing build");
  } catch (error) {
    console.error(
      `::error::packed-install-smoke: ${error instanceof Error ? error.message : error}`,
    );
    if (server) {
      console.error(
        `server output (tail):\n${server.output.text.split("\n").slice(-25).join("\n")}`,
      );
    }
    process.exitCode = 1;
  } finally {
    if (server) {
      await stopServer(server.child);
    }
    if (keep) {
      console.log(`kept ${scratch}`);
    } else {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

/** The build list from the API; its first entry is the newest build. */
async function newestBuild(url, token) {
  const response = await fetch(`${url}/api/v1/projects/packed-smoke/builds`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  const builds = JSON.parse(text);
  const list = Array.isArray(builds) ? builds : (builds.builds ?? builds.items ?? []);
  return { build: list[0], text };
}

/** The one build must finish capture without failing, and hold snapshots. */
async function assertBuildPassed(url, token) {
  const deadline = Date.now() + 120_000;
  let last = "";
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- poll
    const { build, text } = await newestBuild(url, token);
    last = text;
    // A first build has no baseline, so a finished capture waits for review (`reviewing`).
    if (build?.status === "reviewing" || build?.status === "approved") {
      if (!(build.snapshotCount > 0)) {
        fail(`build ${build.status} with no snapshots\n${last}`);
      }
      return;
    }
    if (build?.status === "failed" || build?.status === "cancelled") {
      fail(`build ended ${build.status}\n${last}`);
    }
    // oxlint-disable-next-line no-await-in-loop -- poll interval
    await sleep(1000);
  }
  fail(`build never passed\n${last}`);
}

await main();
process.exit(process.exitCode ?? 0);
