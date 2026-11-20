#!/usr/bin/env node
// oxlint-disable max-statements curly no-console
/**
 * Install StoryShelf the way a user does, from real `npm pack` tarballs, and run it (#393 launch slice).
 *
 * Unit and smoke tests link workspace packages by hand, which hid a missing dependency
 * in the default scaffold (#1137). This script has no workspace links at all:
 *
 *  1. pack every public package (manifests rewritten as the release does, then restored),
 *  2. install the CLI from its tarball in an empty directory outside this checkout,
 *  3. run the default `storyshelf server init` (answers: all defaults, so local accounts),
 *  4. `npm install` the scaffold, with every @storyshelf/* dependency (direct or transitive)
 *     resolved to a tarball instead of the registry,
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
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
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

/** Run a command to completion, inheriting nothing; fail with its output unless it exits 0. */
function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    fail(
      `\`${command} ${argv.join(" ")}\` exited ${result.status}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return result.stdout;
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
 * Answer `storyshelf server init` with its defaults: Enter whenever the prompt has been quiet
 * for a moment (the prompts library redraws with escape codes, so lines cannot be counted).
 * The scaffold lands in `./my-storyshelf` of `cwd`. Resolves when the CLI exits.
 */
function initWithDefaults(cli, cwd) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [cli, "server", "init"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let idle;
    const output = collect(child, (state) => {
      clearTimeout(idle);
      if (state.text.includes("npm start")) {
        // The last line of the next steps: the CLI has finished (it may linger on stdin).
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
      done({ code, output: output.text });
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

/** The CLI installed from its tarball, and the scaffold installed from the tarballs. */
async function installFromTarballs(scratch, tarballs) {
  const tool = join(scratch, "tool");
  mkdirSync(tool);
  // The CLI's own @storyshelf/* dependencies (affected) must come from tarballs too, not the registry.
  const toolPackage = {
    name: "tool",
    private: true,
    dependencies: { storyshelf: `file:${tarballs["storyshelf"]}` },
    overrides: tarballOverrides(tarballs),
  };
  writeFileSync(join(tool, "package.json"), `${JSON.stringify(toolPackage, null, 2)}\n`);
  log("installing the CLI from its tarball");
  run("npm", ["install", "--no-audit", "--no-fund"], { cwd: tool });
  const cli = join(tool, "node_modules/storyshelf/dist/index.js");

  const project = join(scratch, "my-storyshelf");
  log("storyshelf server init (all defaults)");
  const init = await initWithDefaults(cli, scratch);
  if (!init.output.includes("Scaffolded") || !existsSync(join(project, "package.json"))) {
    fail(`server init failed (exit ${init.code})\n${init.output}`);
  }
  const pkg = useTarballs(project, tarballs);
  log(`scaffold depends on: ${Object.keys(pkg.dependencies).join(", ")}`);
  run("npm", ["install", "--no-audit", "--no-fund"], { cwd: project });
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
      DATA_DIR: join(project, "data"),
      SECRET,
      // The default scaffold uses local accounts, which need all three variables.
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      AUTH_PASSWORD: PASSWORD,
      STORYSHELF_ADMIN_TOKEN: ADMIN_TOKEN,
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
    "packed-1",
  ];
  const uploaded = run(process.execPath, [cli, "upload", ...uploadArgs], {
    cwd: sb,
    env: { ...process.env, STORYSHELF_TOKEN: ciToken },
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
