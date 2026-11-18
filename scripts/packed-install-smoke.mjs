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
 *  3. run the default `storyshelf server init` (answers: all defaults),
 *  4. `npm install` the scaffold, with every @storyshelf/* dependency (direct or transitive)
 *     resolved to a tarball instead of the registry,
 *  5. `npm start`, then `storyshelf create` and `storyshelf upload` of a built Storybook,
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
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getPublishOrder, packagesDir } from "./publish-order.mjs";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const storybookArg = args.indexOf("--storybook");
const storybookDir = resolve(
  storybookArg === -1 ? join(root, "fixtures/storybook-9") : (args[storybookArg + 1] ?? ""),
);
const ADMIN_TOKEN = "packed-smoke-admin-token";
const SECRET = "packed-smoke-secret-packed-smoke-secret";

function log(message) {
  console.log(`\n[packed-smoke] ${message}`);
}

function fail(message) {
  console.error(`::error::packed-install-smoke: ${message}`);
  process.exit(1);
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
      writeFileSync(file, content);
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
    let output = "";
    let idle;
    const enterWhenQuiet = () => {
      clearTimeout(idle);
      idle = setTimeout(() => child.stdin.write("\n"), 400);
    };
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        output += chunk.toString();
        if (output.includes("npm start")) {
          // The last line of the next steps: the CLI has finished (it may linger on stdin).
          clearTimeout(idle);
          child.stdin.end();
          setTimeout(() => child.kill("SIGTERM"), 1000);
          return;
        }
        enterWhenQuiet();
      });
    }
    const timeout = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("exit", (code) => {
      clearTimeout(idle);
      clearTimeout(timeout);
      done({ code, output });
    });
  });
}

/** Point every @storyshelf/* dependency at its tarball, transitive ones through `overrides`. */
function useTarballs(projectDir, tarballs) {
  const file = join(projectDir, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  const own = Object.keys(tarballs);
  const direct = Object.keys(pkg.dependencies ?? {}).filter((name) => own.includes(name));
  for (const name of direct) {
    pkg.dependencies[name] = `file:${tarballs[name]}`;
  }
  pkg.overrides = Object.fromEntries(own.map((name) => [name, `file:${tarballs[name]}`]));
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  return pkg;
}

async function waitForOk(url, server, timeoutMs, readLog) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      fail(`server exited early with code ${server.exitCode}\n${readLog()}`);
    }
    try {
      // oxlint-disable-next-line no-await-in-loop -- poll until the server answers
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
    } catch {
      // not listening yet
    }
    // oxlint-disable-next-line no-await-in-loop -- poll interval
    await new Promise((r) => setTimeout(r, 300));
  }
  return fail(`no answer from ${url} within ${timeoutMs} ms\n${readLog()}`);
}

async function main() {
  if (!existsSync(join(storybookDir, "storybook-static/index.json"))) {
    fail(`no built Storybook in ${storybookDir}/storybook-static (build it first)`);
  }
  // Outside this checkout, so no ancestor node_modules can satisfy a missing dependency.
  const scratch = mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "packed-smoke-"));
  let server;
  let serverLog = "";
  try {
    log(`scratch directory ${scratch}`);
    const tarDir = join(scratch, "tarballs");
    mkdirSync(tarDir);
    log("packing every public package");
    const tarballs = packAll(tarDir);
    log(`packed ${Object.keys(tarballs).length} packages`);

    const tool = join(scratch, "tool");
    mkdirSync(tool);
    writeFileSync(join(tool, "package.json"), '{ "name": "tool", "private": true }\n');
    log("installing the CLI from its tarball");
    run("npm", ["install", "--no-audit", "--no-fund", tarballs["storyshelf"]], { cwd: tool });
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

    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    log(`npm start on :${port}`);
    server = spawn("npm", ["start"], {
      cwd: project,
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: join(project, "data"),
        SECRET,
        STORYSHELF_ADMIN_TOKEN: ADMIN_TOKEN,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [server.stdout, server.stderr]) {
      stream.on("data", (chunk) => (serverLog += chunk.toString()));
    }
    await waitForOk(`${url}/api/v1/health`, server, 60_000, () => serverLog);

    // A copy, so `create` writes .storybook/storyshelf.json into scratch and not the fixture.
    const sb = join(scratch, "storybook");
    mkdirSync(sb);
    cpSync(join(storybookDir, ".storybook"), join(sb, ".storybook"), { recursive: true });
    cpSync(join(storybookDir, "storybook-static"), join(sb, "storybook-static"), {
      recursive: true,
    });
    cpSync(join(storybookDir, "package.json"), join(sb, "package.json"));
    rmSync(join(sb, ".storybook/storyshelf.json"), { force: true });

    log("storyshelf create");
    const created = run(
      process.execPath,
      [cli, "create", "--url", url, "--name", "packed-smoke", "--token", ADMIN_TOKEN],
      { cwd: sb },
    );
    const ciToken = /CI token: (\S+)/u.exec(created)?.[1];
    if (!ciToken) {
      fail(`create printed no CI token\n${created}`);
    }

    log("storyshelf upload");
    const uploaded = run(
      process.execPath,
      [
        cli,
        "upload",
        "--build-dir",
        "storybook-static",
        "--branch",
        "main",
        "--sha",
        "packed-smoke-1",
      ],
      { cwd: sb, env: { ...process.env, STORYSHELF_TOKEN: ciToken } },
    );
    console.log(uploaded);

    await assertBuildPassed(url, ciToken);
    log("ok: packed install, scaffold, start, create, upload and one passing build");
  } catch (error) {
    fail(error instanceof Error ? error.stack : String(error));
  } finally {
    server?.kill("SIGTERM");
    if (keep) {
      console.log(`kept ${scratch}`);
    } else {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

/** The one build must finish capture without failing, and hold snapshots. */
async function assertBuildPassed(url, token) {
  const headers = { authorization: `Bearer ${token}` };
  const deadline = Date.now() + 120_000;
  let last = "";
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- poll
    const response = await fetch(`${url}/api/v1/projects/packed-smoke/builds`, { headers });
    last = await response.text();
    const builds = JSON.parse(last);
    const list = Array.isArray(builds) ? builds : (builds.builds ?? builds.items ?? []);
    const status = list[0]?.status;
    // A first build has no baseline, so a finished capture waits for review (`reviewing`).
    if (status === "reviewing" || status === "approved") {
      if (!(list[0].snapshotCount > 0)) {
        fail(`build ${status} with no snapshots\n${last}`);
      }
      return;
    }
    if (status === "failed" || status === "cancelled") {
      fail(`build ended ${status}\n${last}`);
    }
    // oxlint-disable-next-line no-await-in-loop -- poll interval
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`build never passed\n${last}`);
}

await main();
