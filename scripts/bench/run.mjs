// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
/* oxlint-disable */
/** One benchmark iteration (issue #853): three uploads, the capture of each, serving and pages. */
import { cpSync, readFileSync, rmSync, appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { root, startApp, storageReport, upload, waitForBuild } from "./harness.mjs";
import { captureReport, pagesReport, servingReport } from "./measure.mjs";

export const FIXTURE = join(root, "fixtures/storybook-9/storybook-static");

/** A copy of the built Storybook with one asset changed by one byte (a one-file change). */
function changedCopy(into) {
  rmSync(into, { recursive: true, force: true });
  cpSync(FIXTURE, into, { recursive: true });
  const assets = join(into, "assets");
  const target = readdirSync(assets).find((name) => name.endsWith(".js"));
  appendFileSync(join(assets, target), "\n/* bench: one-file change */\n");
  return { dir: into, file: `assets/${target}` };
}

function firstStory() {
  const index = JSON.parse(readFileSync(join(FIXTURE, "index.json"), "utf8"));
  const entry = Object.values(index.entries).find((one) => one.type === "story");
  return { id: entry.id, importPath: entry.importPath };
}

/** Upload, wait for the capture to end, and report it with the storage afterwards. */
async function step(system, buildDir, sha) {
  system.dbCalls.length = 0;
  const startedAt = performance.now();
  const buildId = await upload(system, buildDir, sha);
  const waited = await waitForBuild(system, buildId);
  const capture = await captureReport(system, buildId, waited, startedAt);
  return { buildId, capture, storage: storageReport(system.dir) };
}

export async function runOnce(dir, scratch) {
  const system = await startApp(dir);
  try {
    const story = firstStory();
    const first = await step(system, FIXTURE, "sha-1");
    const unchanged = await step(system, FIXTURE, "sha-2");
    const changed = changedCopy(join(scratch, "changed"));
    const oneFile = await step(system, changed.dir, "sha-3");
    return {
      storage: {
        firstUpload: first.storage,
        unchanged: unchanged.storage,
        oneFileChange: oneFile.storage,
      },
      changedFile: changed.file,
      capture: {
        first: first.capture,
        unchanged: unchanged.capture,
        oneFileChange: oneFile.capture,
      },
      serving: await servingReport(system, first.buildId, story.id),
      pages: await pagesReport(system, first.buildId, story.importPath),
    };
  } finally {
    await system.stop();
  }
}
