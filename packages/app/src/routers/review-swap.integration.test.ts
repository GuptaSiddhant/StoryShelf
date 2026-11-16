import { CommentModel, SnapshotModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubRunner } from "../test-runner.ts";

/**
 * Review without page loads (#937): approve and reject from the review page answer HTMX with the
 * next snapshot to swap in place, the header and filmstrip out of band and `HX-Push-Url`; a
 * posted snapshot comment answers with its card. Plain and API callers keep their answers.
 */

const T1 = "2026-01-01T00:00:00.000Z";
const API = "/api/v1/projects/test-project/builds/f1";
const PAGE = "/projects/test-project/builds/f1/diff";
const REVIEW_PAGE = `https://shelf.test${PAGE}`;

const project: Project = {
  id: "p1",
  name: "Test Project",
  slug: "test-project",
  gitRepository: "owner/repo",
  gitDefaultBranch: "main",
  pixelThreshold: 0.1,
  maxDiffRatio: 0.01,
  publicBranchRegex: null,
  executePlay: false,
  playTimeoutMs: 10_000,
  storybookMeta: null,
  createdAt: T1,
  updatedAt: T1,
};

const build = {
  id: "f1",
  projectId: "p1",
  gitSha: "sha-f1",
  gitBranch: "feature/x",
  isDefault: false,
  authorEmail: null,
  authorName: null,
  message: null,
  public: false,
  status: "reviewing",
  snapshotCount: 3,
  changedCount: 3,
  approvedCount: 0,
  rejectedCount: 0,
  inheritedCount: 0,
  affectedOnly: true,
  baselineSha: null,
  changedFiles: null,
  affectedImportPaths: null,
  createdAt: T1,
  updatedAt: T1,
} as Build;

/** Three open snapshots of three stories: Alpha, Bravo and Charlie (s1, s2, s3). */
async function setup() {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(db.tables.projects, project);
  await db.insert(db.tables.builds, build);
  const seeds = [
    ["s1", "alpha", "Alpha"],
    ["s2", "bravo", "Bravo"],
    ["s3", "charlie", "Charlie"],
  ] as const;
  for (const [id, storyId, storyName] of seeds) {
    objects.set(`shots/${id}.png`, Buffer.from(id));
    // oxlint-disable-next-line no-await-in-loop -- inserted in order so the list order is fixed
    await db.insert(db.tables.snapshots, {
      id,
      projectId: "p1",
      buildId: "f1",
      storyId,
      storyName,
      storyTitle: "Kit",
      viewportName: "desktop",
      browser: "chromium",
      screenshotPath: `shots/${id}.png`,
      status: "new",
      baselineId: null,
      baselineVersion: "none",
      createdAt: T1,
      updatedAt: T1,
    });
  }
  const app = createShelfApp({
    testing: { runner: stubRunner() },
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    config: { secret: "s" },
  });
  return { app, db };
}

type App = Awaited<ReturnType<typeof setup>>["app"];

/** An HTMX post from the review page (or `from` elsewhere). */
async function hxPost(app: App, path: string, from = REVIEW_PAGE): Promise<Response> {
  return await app.request(path, {
    method: "POST",
    headers: { "HX-Request": "true", "HX-Current-URL": from },
  });
}

async function statusOf(db: Awaited<ReturnType<typeof setup>>["db"], id: string) {
  return (await new SnapshotModel(db).get(id))?.status;
}

describe("approve and reject from the review page", () => {
  it("answers an HTMX approve with the next snapshot's viewer, the OOB header and list, and HX-Push-Url", async () => {
    const { app, db } = await setup();

    const response = await hxPost(app, `${API}/snapshots/s1/approve`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("HX-Push-Url")).toBe(`${PAGE}?snapshot=s2`);
    expect(response.headers.get("HX-Redirect")).toBeNull();
    const html = await response.text();
    expect(html).toMatch(/<div[^>]*id="review-canvas"/u);
    expect(html).toMatch(/id="snapshot-heading"[^>]*>[^<]*Bravo/u);
    expect(html).toMatch(/<header[^>]*id="review-header"[^>]*hx-swap-oob="true"/u);
    expect(html).toMatch(/<aside[^>]*id="review-filmstrip"[^>]*hx-swap-oob="true"/u);
    expect(html).toContain("1 of 3 reviewed");
    expect(html).toMatch(/data-snapshot-id="s1"[^>]*data-status="approved"/u);
    expect(html).not.toContain("<html");
    expect(html).not.toContain("skip-link");
    // Its styles travel as one block for the shell to merge, never as an append script per swap.
    expect(html.startsWith('<style id="storyshelf-css">')).toBe(true);
    expect(html).not.toContain("textContent+=");
    expect(await statusOf(db, "s1")).toBe("approved");
  });

  it("answers an HTMX reject the same way", async () => {
    const { app, db } = await setup();

    const response = await hxPost(app, `${API}/snapshots/s2/reject`);

    expect(response.status).toBe(200);
    expect(response.headers.get("HX-Push-Url")).toBe(`${PAGE}?snapshot=s3`);
    expect(await response.text()).toMatch(/id="snapshot-heading"[^>]*>[^<]*Charlie/u);
    expect(await statusOf(db, "s2")).toBe("rejected");
  });

  it("answers an HTMX story/mode decision with the next open story", async () => {
    const { app } = await setup();

    const response = await hxPost(app, `${API}/stories/alpha/modes/desktop/approve`);

    expect(response.status).toBe(200);
    expect(response.headers.get("HX-Push-Url")).toBe(`${PAGE}?snapshot=s2`);
  });

  it("shows the build's done state when the last open snapshot is decided", async () => {
    const { app } = await setup();
    await app.request(`${API}/snapshots/s1/approve`, { method: "POST" });
    await app.request(`${API}/snapshots/s2/reject`, { method: "POST" });

    const response = await hxPost(app, `${API}/snapshots/s3/approve`);

    expect(response.status).toBe(200);
    expect(response.headers.get("HX-Push-Url")).toBe(`${PAGE}?snapshot=s3`);
    const html = await response.text();
    expect(html).toContain("Review complete");
    expect(html).toContain("All 3 changes in this build are reviewed.");
    expect(html).toContain("3 of 3 reviewed");
    expect(html).not.toContain("data-approve");
  });

  it("keeps the JSON answer, with no swap headers, for a plain request", async () => {
    const { app, db } = await setup();

    const response = await app.request(`${API}/snapshots/s1/approve`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("HX-Push-Url")).toBeNull();
    expect(await statusOf(db, "s1")).toBe("approved");
  });

  it("reloads the page for an HTMX decision made elsewhere than the review page", async () => {
    const { app } = await setup();

    const response = await hxPost(
      app,
      `${API}/snapshots/s1/approve`,
      "https://shelf.test/projects/test-project/library",
    );

    expect(response.headers.get("HX-Refresh")).toBe("true");
    expect(await response.json()).toEqual({ ok: true });
  });
});

/** Post the review page's snapshot comment form, with these extra headers. */
async function postComment(app: App, headers: Record<string, string>): Promise<Response> {
  return await app.request("/projects/test-project/builds/f1/comments", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-csrf-token": getCsrfToken("s"),
      ...headers,
    },
    body: new URLSearchParams({ body: "Padding looks off", snapshotId: "s2" }).toString(),
  });
}

describe("posting a snapshot comment from the review page", () => {
  it("answers the comment form with its card: the new comment listed and the box empty", async () => {
    const { app, db } = await setup();

    const response = await postComment(app, {
      "HX-Request": "true",
      "HX-Target": "snapshot-comments",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("HX-Refresh")).toBeNull();
    const html = await response.text();
    expect(html).toMatch(/id="snapshot-comments"/u);
    expect(html).toContain("Padding looks off");
    expect(html).toMatch(/<textarea[^>]*autofocus[^>]*><\/textarea>/u);
    expect(html).not.toContain("textContent+=");
    expect(html).not.toContain("<html");
    expect(await new CommentModel(db).listByBuild("f1")).toMatchObject([{ snapshotId: "s2" }]);
  });

  it("still reloads for an HTMX comment form that targets the page", async () => {
    const { app } = await setup();

    const response = await postComment(app, { "HX-Request": "true" });

    expect(response.status).toBe(204);
    expect(response.headers.get("HX-Refresh")).toBe("true");
  });
});
