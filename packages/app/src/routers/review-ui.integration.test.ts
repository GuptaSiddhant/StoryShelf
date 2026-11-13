import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
import {
  BuildModel,
  BuildReviewModel,
  CommentModel,
  MemberModel,
  NotificationSubscriptionModel,
  WebhookModel,
} from "@storyshelf/core/models";
import { makeDatabase, makeStorage, publicNetworkForTests } from "@storyshelf/core/test-helpers";
import type { ProjectRole } from "@storyshelf/core/types";
import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { REVIEW_DISABLED_MESSAGE } from "../middleware/require-review.ts";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

/**
 * The review UI and its gate (ADR 0013): the changeset, the verdict controls and the comments of
 * the build page, story comments on the component page, the per-project switch and the events.
 */

const SHA = "d".repeat(40);
const NOW = "2026-01-01T00:00:00.000Z";
const ROLES: Record<string, ProjectRole> = {
  admin: "admin",
  alice: "approver",
  dev: "developer",
  view: "viewer",
};

const users = [...Object.keys(ROLES), "outsider"].map((id) => ({
  id,
  email: `${id}@example.com`,
  name: id === "alice" ? "Alice Reviewer" : id,
  role: id === "admin" ? ("admin" as const) : ("member" as const),
}));

const auth = stubAuth(null, {
  check: async (request: Request) => {
    const cookie = request.headers.get("cookie") ?? "";
    const id = /storyshelf_session=(?<id>\w+)/u.exec(cookie)?.groups?.["id"];
    return await Promise.resolve(users.find((user) => user.id === id) ?? null);
  },
});

let scratchDir = "";
/** Stop functions of the apps the running test booted; `afterEach` runs them, whatever the outcome. */
const running: (() => Promise<void>)[] = [];

/** Stop every app the test booted, give each its chance, then report the ones that failed. */
async function stopApps(): Promise<void> {
  const stopped = await Promise.allSettled(running.splice(0).map(async (stop) => await stop()));
  const failures = stopped.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, "an app did not stop cleanly");
  }
}

let restoreNetwork: (() => void) | undefined;
beforeEach(async () => {
  restoreNetwork = publicNetworkForTests();
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-review-ui-"));
});
afterEach(async () => {
  restoreNetwork?.();
  try {
    await stopApps();
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
});

type Stories = Record<string, { title: string; importPath: string; name?: string }>;

const BUTTON: Stories = {
  "button--primary": { title: "Button", importPath: "./Button.stories.tsx", name: "Primary" },
  "card--basic": { title: "Card", importPath: "./Card.stories.tsx", name: "Basic" },
};

function storybookZip(stories: Stories): Buffer {
  const zip = new AdmZip();
  zip.addFile("iframe.html", Buffer.from("<html></html>"));
  const entries = Object.fromEntries(
    Object.entries(stories).map(([id, story]) => [
      id,
      { type: "story", id, name: story.name ?? "Story", ...story },
    ]),
  );
  zip.addFile("index.json", Buffer.from(JSON.stringify({ v: 5, entries })));
  return zip.toBuffer();
}

async function boot(options: { testing?: boolean; project?: Record<string, unknown> } = {}) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const sent: string[] = [];
  // The project's room (`log`) and a personal transport (`dm`, which a future direct-message
  // provider would declare itself), both recording the subjects they are asked to send.
  const providerOf = (kind: string, audience: "person" | "room"): NotifierProvider => {
    const metadata = {
      name: kind,
      version: "0.0.0",
      kind,
      category: "notifier" as const,
      audience,
      schema: z.object({}).loose(),
    };
    return {
      metadata,
      create: () => ({
        metadata,
        // oxlint-disable-next-line eslint/require-await -- send is async by contract
        send: async (input: unknown) => {
          sent.push((input as { formatted: { subject: string } }).formatted.subject);
        },
      }),
    };
  };
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Gate",
    slug: "gate",
    gitRepository: "acme/widgets",
    gitDefaultBranch: "main",
    reviewEnabled: true,
    reviewApprovals: 1,
    ...options.project,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await Promise.all(
    users.map(async (user) => {
      await db.insert(db.tables.users, {
        ...user,
        avatarUrl: null,
        lastLoginAt: null,
        createdAt: NOW,
      });
    }),
  );
  await Promise.all(
    Object.entries(ROLES)
      .filter(([id]) => id !== "admin")
      .map(async ([id, role]) => await new MemberModel(db).set("p1", id, role)),
  );
  const app = createShelfApp({
    database: db,
    storage,
    auth,
    ...(options.testing === true ? { testing: { runner: stubRunner() } } : {}),
    config: { secret: "s", scratchDir, publicBaseUrl: "https://shelf.example" },
    notifications: { notifiers: [providerOf("log", "room"), providerOf("dm", "person")] },
    logger: pino({ level: "silent" }),
  });
  // Registered before `setup()`: the app starts its timers when it is created, so a failed setup
  // still has to reach `teardown()`.
  const stop = async (): Promise<void> => await app.lifecycle.teardown();
  running.push(stop);
  await app.lifecycle.setup();
  const request =
    (prefix: string) =>
    async (id: string, path: string, init: RequestInit = {}) =>
      await app.request(`${prefix}${path}`, {
        ...init,
        headers: {
          cookie: `storyshelf_session=${id}`,
          "content-type": "application/json",
          ...(init.headers as Record<string, string> | undefined),
        },
      });
  const api = request("/api/v1/projects/gate");
  const pageRequest = request("/projects/gate");
  /** Page requests carry the CSRF token a signed-in browser's HTMX adds to every write. */
  const page = async (id: string, path: string, init: RequestInit = {}) =>
    await pageRequest(id, path, {
      ...init,
      headers: { "x-csrf-token": getCsrfToken("s", id), ...(init.headers as object) },
    });
  return { app, db, storage, api, page, sent, stop };
}

type Booted = Awaited<ReturnType<typeof boot>>;

async function publish(
  booted: Booted,
  branch: string,
  stories: Stories = BUTTON,
  sha = SHA,
): Promise<string> {
  const created = await booted.api("dev", "/builds", {
    method: "POST",
    body: JSON.stringify({ gitSha: sha, gitBranch: branch }),
  });
  expect(created.status).toBe(202);
  const { build } = (await created.json()) as { build: { id: string } };
  const upload = await booted.app.request(`/api/v1/projects/gate/builds/${build.id}/zip`, {
    method: "PUT",
    headers: { cookie: "storyshelf_session=dev", "content-type": "application/zip" },
    body: new Uint8Array(storybookZip(stories)),
  });
  expect(upload.status).toBe(202);
  return build.id;
}

/** Spread builds apart in time so "accepted before this build" is well defined. */
async function stamp(booted: Booted, id: string, createdAt: string): Promise<void> {
  await booted.db.update(booted.db.tables.builds, id, { createdAt });
}

describe("the review gate", () => {
  const REVIEW_ROUTES: [string, string][] = [
    ["GET", "/builds/b1/comments"],
    ["POST", "/builds/b1/comments"],
    ["POST", "/builds/b1/comments/c1/resolve"],
    ["GET", "/builds/b1/reviews"],
    ["POST", "/builds/b1/reviews"],
    ["GET", "/builds/b1/changeset"],
  ];

  it("answers 404 on every review route of a project with review off", async () => {
    const booted = await boot({ project: { reviewEnabled: false } });
    const responses = await Promise.all(
      REVIEW_ROUTES.map(async ([method, path]) => {
        const response = await booted.api("alice", path, {
          method,
          ...(method === "POST"
            ? { body: JSON.stringify({ body: "x", verdict: "approved" }) }
            : {}),
        });
        return { key: `${method} ${path}`, status: response.status, body: await response.json() };
      }),
    );
    for (const { key, status, body } of responses) {
      expect(status, key).toBe(404);
      expect(body).toEqual({ error: { message: REVIEW_DISABLED_MESSAGE } });
    }
  });

  it("lets the same routes through on a project with review on", async () => {
    const booted = await boot();
    const id = await publish(booted, "feature/x");
    for (const path of [
      `/builds/${id}/comments`,
      `/builds/${id}/reviews`,
      `/builds/${id}/changeset`,
    ]) {
      // eslint-disable-next-line no-await-in-loop -- few routes
      expect((await booted.api("alice", path)).status, path).toBe(200);
    }
  });

  it("follows the switch from one request to the next", async () => {
    const booted = await boot();
    const id = await publish(booted, "feature/x");
    const patch = async (reviewEnabled: boolean) =>
      await booted.api("admin", "", { method: "PATCH", body: JSON.stringify({ reviewEnabled }) });
    expect((await patch(false)).status).toBe(200);
    expect((await booted.api("alice", `/builds/${id}/comments`)).status).toBe(404);
    expect((await patch(true)).status).toBe(200);
    expect((await booted.api("alice", `/builds/${id}/comments`)).status).toBe(200);
  });

  it("tells nothing about a project to someone who cannot view it", async () => {
    const booted = await boot({ project: { reviewEnabled: false } });
    const response = await booted.api("outsider", "/builds/b1/comments");
    // 404 as for an unknown project, not the 403 that would show the project exists (#497).
    expect(response.status).toBe(404);
    const unknown = await booted.app.request("/api/v1/projects/ghost/builds/b1/comments", {
      headers: { cookie: "storyshelf_session=outsider" },
    });
    const body = await response.text();
    expect(body).toBe(await unknown.text());
    expect(body).not.toContain(REVIEW_DISABLED_MESSAGE);
  });

  it("does not touch the pages of the build when review is off: they still render", async () => {
    const booted = await boot({ project: { reviewEnabled: false } });
    const id = await publish(booted, "feature/x");
    const response = await booted.page("alice", `/builds/${id}/diff`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).not.toContain("Approve build");
    expect(html).not.toContain("Changes in this build");
    expect(html).not.toContain("Add build comment");
  });

  describe("on the form routes of a project with review off", () => {
    const FORM_ROUTES = ["/builds/b1/reviews", "/builds/b1/comments"];
    const formBody = new URLSearchParams({ verdict: "approved", body: "x" }).toString();
    const formHeaders = { "content-type": "application/x-www-form-urlencoded" };

    it("runs the CSRF check, sign-in and the role check before it says review is off", async () => {
      const booted = await boot({ project: { reviewEnabled: false } });
      const probe = async (path: string): Promise<void> => {
        const url = `/projects/gate${path}`;
        const post = async (headers: Record<string, string>) =>
          await booted.app.request(url, {
            method: "POST",
            headers: { ...formHeaders, ...headers },
            body: formBody,
          });
        const noSession = await post({});
        expect(noSession.status, `no session or token ${path}`).toBe(403);
        const anonymous = await post({ "x-csrf-token": getCsrfToken("s", "default") });
        expect(anonymous.status, `anonymous ${path}`).toBe(302);
        expect(anonymous.headers.get("location"), `anonymous ${path}`).toContain("/login");
        const noToken = await post({ cookie: "storyshelf_session=alice" });
        expect(noToken.status, `no CSRF token ${path}`).toBe(403);
        const outsider = await post({
          cookie: "storyshelf_session=outsider",
          "x-csrf-token": getCsrfToken("s", "outsider"),
        });
        // No role at all: the answer for a project that does not exist (#497), not a 403.
        expect(outsider.status, `outsider ${path}`).toBe(404);
        expect(await outsider.text()).not.toContain(REVIEW_DISABLED_MESSAGE);
      };
      await Promise.all(FORM_ROUTES.map(async (path) => await probe(path)));
    });

    it("answers a project member with the plain 404 and nothing about the project", async () => {
      const booted = await boot({ project: { reviewEnabled: false } });
      const id = await publish(booted, "feature/x");
      const response = await booted.page("alice", `/builds/${id}/reviews`, {
        method: "POST",
        headers: formHeaders,
        body: formBody,
      });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe(REVIEW_DISABLED_MESSAGE);
      expect((await new BuildModel(booted.db).get(id))?.status).toBe("approved");
    });

    it("keeps the review switch form reachable, so an admin can turn review back on", async () => {
      const booted = await boot({ project: { reviewEnabled: false } });
      const blocked = await booted.page("alice", "/builds/b1/reviews", {
        method: "POST",
        headers: formHeaders,
        body: formBody,
      });
      expect(blocked.status).toBe(404);
      const saved = await booted.page(
        "admin",
        "/settings/review",
        form({ reviewEnabled: "true", reviewApprovals: "1" }),
      );
      expect(saved.status).toBe(204);
      const project = (await (await booted.api("admin", "")).json()) as { reviewEnabled: boolean };
      expect(project.reviewEnabled).toBe(true);
    });
  });

  it("answers the verdict form as it answers the JSON API: same refusals, same stored review", async () => {
    const booted = await boot();
    const viaForm = await publish(booted, "feature/form");
    const viaApi = await publish(booted, "feature/api", BUTTON, "a".repeat(40));
    const asForm = async (user: string, id: string, fields: Record<string, string>) =>
      (await booted.page(user, `/builds/${id}/reviews`, form(fields))).status;
    const asApi = async (user: string, id: string, body: Record<string, string>) =>
      (
        await booted.api(user, `/builds/${id}/reviews`, {
          method: "POST",
          body: JSON.stringify(body),
        })
      ).status;
    const builds = new BuildModel(booted.db);
    const reviews = new BuildReviewModel(booted.db);
    const untouched = async () =>
      await Promise.all(
        [viaForm, viaApi].map(async (id) => ({
          status: (await builds.get(id))?.status,
          reviews: await reviews.listByBuild(id),
        })),
      );
    const before = await untouched();

    // A developer may not give a verdict; an unknown verdict is a bad request. Both change nothing.
    expect(await asForm("dev", viaForm, { verdict: "approved" })).toBe(403);
    expect(await asApi("dev", viaApi, { verdict: "approved" })).toBe(403);
    expect(await asForm("alice", viaForm, { verdict: "maybe" })).toBe(400);
    expect(await asApi("alice", viaApi, { verdict: "maybe" })).toBe(400);
    expect(await untouched()).toEqual(before);

    expect(await asForm("alice", viaForm, { verdict: "approved", body: "ok" })).toBe(204);
    expect(await asApi("alice", viaApi, { verdict: "approved", body: "ok" })).toBe(201);
    for (const id of [viaForm, viaApi]) {
      // eslint-disable-next-line no-await-in-loop -- two builds
      expect((await builds.get(id))?.status).toBe("approved");
      // eslint-disable-next-line no-await-in-loop -- two builds
      expect(await reviews.listByBuild(id)).toMatchObject([{ verdict: "approved", body: "ok" }]);
    }
  });
});

describe("the changeset", () => {
  it("compares a build with the latest accepted build of its branch, else of the default branch", async () => {
    const booted = await boot();
    const base = await publish(booted, "main");
    await stamp(booted, base, "2026-02-01T00:00:00.000Z");
    const next = await publish(
      booted,
      "feature/x",
      {
        "button--primary": { ...BUTTON["button--primary"]!, name: "Renamed" },
        "table--basic": { title: "Table", importPath: "./Table.stories.tsx" },
      },
      "e".repeat(40),
    );
    await stamp(booted, next, "2026-02-02T00:00:00.000Z");

    const response = await booted.api("view", `/builds/${next}/changeset`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      baseline: { id: string } | null;
      added: { title: string }[];
      removed: { title: string }[];
      changed: { title: string }[];
      unchanged: number;
    };
    expect(body.baseline?.id).toBe(base);
    expect(body.added.map((item) => item.title)).toEqual(["Table"]);
    expect(body.removed.map((item) => item.title)).toEqual(["Card"]);
    expect(body.changed.map((item) => item.title)).toEqual(["Button"]);
    expect(body.unchanged).toBe(0);
  });

  it("shows the first build's components as added, with no baseline", async () => {
    const booted = await boot();
    const id = await publish(booted, "main");
    const body = (await (await booted.api("view", `/builds/${id}/changeset`)).json()) as {
      baseline: unknown;
      added: unknown[];
    };
    expect(body.baseline).toBeNull();
    expect(body.added).toHaveLength(2);
  });
});

describe("the build page without testing", () => {
  it("shows the verdict controls to approvers, the changeset and the story comments", async () => {
    const booted = await boot();
    const base = await publish(booted, "main");
    await stamp(booted, base, "2026-02-01T00:00:00.000Z");
    const id = await publish(
      booted,
      "feature/x",
      { ...BUTTON, "table--basic": { title: "Table", importPath: "./Table.stories.tsx" } },
      "f".repeat(40),
    );
    await stamp(booted, id, "2026-02-02T00:00:00.000Z");
    const commented = await booted.api("dev", `/builds/${id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: "Spacing looks off here", storyId: "button--primary" }),
    });
    expect(commented.status).toBe(201);

    const html = await (await booted.page("alice", `/builds/${id}/diff`)).text();
    expect(html).toContain("Approve build");
    expect(html).toContain("Reject build");
    expect(html).toContain("waiting for review");
    expect(html).toContain("0 of 1 approval given");
    expect(html).toContain("Changes in this build");
    expect(html).toContain("Table");
    expect(html).toContain("1 added");
    expect(html).toContain("Spacing looks off here");
    expect(html).toContain("story button--primary");
    expect(html).toContain("Add build comment");
    expect(html).toContain(`/projects/gate/storybook/build/${id}/?path=/story/table--basic`);
  });

  it("gives developers and viewers no verdict controls, and viewers no comment form", async () => {
    const booted = await boot();
    const id = await publish(booted, "feature/x");
    const dev = await (await booted.page("dev", `/builds/${id}/diff`)).text();
    expect(dev).not.toContain("Approve build");
    expect(dev).toContain("Add build comment");
    const viewer = await (await booted.page("view", `/builds/${id}/diff`)).text();
    expect(viewer).not.toContain("Approve build");
    expect(viewer).not.toContain("Add build comment");
    expect(viewer).toContain("Changes in this build");
  });

  it("takes a verdict from the form and lists it", async () => {
    const booted = await boot();
    const id = await publish(booted, "feature/x");
    const posted = await booted.page("alice", `/builds/${id}/reviews`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "hx-request": "true" },
      body: new URLSearchParams({ verdict: "approved", body: "Looks good" }).toString(),
    });
    expect(posted.status).toBe(204);
    expect(posted.headers.get("hx-refresh")).toBe("true");
    expect((await new BuildModel(booted.db).get(id))?.status).toBe("approved");

    const html = await (await booted.page("view", `/builds/${id}/diff`)).text();
    expect(html).toContain("Alice Reviewer");
    expect(html).toContain("Looks good");
    expect(html).toContain("1 of 1 approval given");
  });

  it("tells the reviewer a build that is still publishing cannot be reviewed yet", async () => {
    const booted = await boot();
    const created = await booted.api("dev", "/builds", {
      method: "POST",
      body: JSON.stringify({ gitSha: SHA, gitBranch: "feature/x" }),
    });
    const { build } = (await created.json()) as { build: { id: string } };
    const posted = await booted.page("alice", `/builds/${build.id}/reviews`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ verdict: "approved" }).toString(),
    });
    expect(posted.status).toBe(409);
    expect(await posted.text()).toContain("still publishing");
    expect((await new BuildModel(booted.db).get(build.id))?.status).toBe("pending");
    const html = await (await booted.page("alice", `/builds/${build.id}/diff`)).text();
    expect(html).toContain("Waiting for the Storybook to publish");
    expect(html).toMatch(/<button[^>]*disabled[^>]*value="approved"/u);
    expect(html).toMatch(/<button[^>]*disabled[^>]*value="rejected"/u);
  });

  it("still renders the build page when the storage probe fails", async () => {
    const booted = await boot();
    const id = await publish(booted, "feature/x");
    vi.spyOn(booted.storage, "exists").mockRejectedValue(new Error("storage down"));
    const response = await booted.page("alice", `/builds/${id}/diff`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Waiting for the Storybook to publish");
  });

  it("takes a comment from the form", async () => {
    const booted = await boot();
    const id = await publish(booted, "feature/x");
    const posted = await booted.page("dev", `/builds/${id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "hx-request": "true" },
      body: new URLSearchParams({ body: "From the form", storyId: "card--basic" }).toString(),
    });
    expect(posted.status).toBe(204);
    const [comment] = await new CommentModel(booted.db).listByBuild(id);
    expect(comment).toMatchObject({ body: "From the form", storyId: "card--basic" });

    const resolved = await booted.page("dev", `/builds/${id}/comments/${comment?.id}/resolve`, {
      method: "POST",
      headers: { "hx-request": "true" },
    });
    expect(resolved.status).toBe(204);
    expect((await new CommentModel(booted.db).listByBuild(id))[0]?.resolved).toBe(true);

    const plain = await booted.page("dev", `/builds/${id}/comments`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: "http://localhost/projects/gate/components/Card.stories.tsx?story=card--basic",
      },
      body: new URLSearchParams({ body: "Plain post" }).toString(),
    });
    expect(plain.status).toBe(303);
    expect(plain.headers.get("location")).toBe(
      "/projects/gate/components/Card.stories.tsx?story=card--basic",
    );
    const away = await booted.page("dev", `/builds/${id}/comments`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: "https://evil.example/phish",
      },
      body: new URLSearchParams({ body: "Cross-site referer" }).toString(),
    });
    expect(away.headers.get("location")).toBe(`/projects/gate/builds/${id}/diff`);
    const empty = await booted.page("dev", `/builds/${id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ body: "  " }).toString(),
    });
    expect(empty.status).toBe(400);
    const foreign = await booted.page("view", `/builds/${id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ body: "viewers read only" }).toString(),
    });
    expect(foreign.status).toBe(403);
  });
});

describe("the build page with testing", () => {
  it("keeps the changeset and the verdict in the details, above the stage", async () => {
    const booted = await boot({ testing: true });
    const id = await publish(booted, "feature/z");
    const html = await (await booted.page("alice", `/builds/${id}/diff`)).text();
    const changes = html.indexOf("Changes in this build");
    const empty = html.indexOf("No snapshots");
    const verdict = html.indexOf("Approve build");
    expect(changes).toBeGreaterThan(-1);
    expect(verdict).toBeGreaterThan(changes);
    expect(empty).toBeGreaterThan(verdict);
    expect(html).toContain("a verdict is a sign-off");
  });

  it("offers Retry capture in the menu to developers, not to viewers", async () => {
    const booted = await boot({ testing: true });
    const id = await publish(booted, "feature/menu");
    const dev = await (await booted.page("dev", `/builds/${id}/diff`)).text();
    const viewer = await (await booted.page("view", `/builds/${id}/diff`)).text();
    expect(dev).toContain("Retry capture");
    expect(viewer).not.toContain("Retry capture");
  });
});

describe("the component page", () => {
  it("lists the story's comments of the build it shows and offers a form", async () => {
    const booted = await boot();
    const id = await publish(booted, "main");
    await booted.api("dev", `/builds/${id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: "Primary needs a focus ring", storyId: "button--primary" }),
    });
    await booted.api("dev", `/builds/${id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: "About another story", storyId: "card--basic" }),
    });
    const response = await booted.page(
      "dev",
      "/components/Button.stories.tsx?story=button--primary",
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Comments on this story");
    expect(html).toContain("Primary needs a focus ring");
    expect(html).not.toContain("About another story");
    expect(html).toContain("Add story comment");
    expect(html).toContain('name="storyId"');

    const viewer = await (
      await booted.page("view", "/components/Button.stories.tsx?story=button--primary")
    ).text();
    expect(viewer).toContain("Primary needs a focus ring");
    expect(viewer).not.toContain("Add story comment");
  });

  it("has no comments section when the project has review off", async () => {
    const booted = await boot({ project: { reviewEnabled: false } });
    await publish(booted, "main");
    const html = await (await booted.page("dev", "/components/Button.stories.tsx")).text();
    expect(html).not.toContain("Comments on this story");
  });
});

const form = (fields: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", "hx-request": "true" },
  body: new URLSearchParams(fields).toString(),
});

describe("the review settings and the switch-off pass", () => {
  it("shows the review card to admins and saves the switch and the approvals", async () => {
    const booted = await boot();
    const html = await (await booted.page("admin", "/settings/review")).text();
    expect(html).toContain("Review builds before they are accepted");
    expect(html).toContain("Approvals required");

    const saved = await booted.page(
      "admin",
      "/settings/review",
      form({ reviewEnabled: "true", reviewApprovals: "3" }),
    );
    expect(saved.status).toBe(204);
    const project = (await (await booted.api("admin", "")).json()) as {
      reviewEnabled: boolean;
      reviewApprovals: number;
    };
    expect(project).toMatchObject({ reviewEnabled: true, reviewApprovals: 3 });
  });

  it("refuses a bad approvals count, and anyone but a project admin", async () => {
    const booted = await boot();
    const bad = await booted.page(
      "admin",
      "/settings/review",
      form({ reviewEnabled: "true", reviewApprovals: "0" }),
    );
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Enter a whole number from 1 to 20");
    const denied = await booted.page(
      "alice",
      "/settings/review",
      form({ reviewEnabled: "", reviewApprovals: "1" }),
    );
    expect(denied.status).toBe(403);
  });

  it("accepts the pending builds nothing worked on when the form turns review off", async () => {
    const booted = await boot();
    const waiting = await publish(booted, "feature/x");
    const decided = await publish(booted, "feature/y", BUTTON, "a".repeat(40));
    await booted.api("alice", `/builds/${decided}/reviews`, {
      method: "POST",
      body: JSON.stringify({ verdict: "rejected" }),
    });
    expect((await new BuildModel(booted.db).get(waiting))?.status).toBe("pending");

    const saved = await booted.page("admin", "/settings/review", form({ reviewApprovals: "1" }));
    expect(saved.status).toBe(204);

    const builds = new BuildModel(booted.db);
    expect((await builds.get(waiting))?.status).toBe("approved");
    // A rejected build was decided by a person; the pass only clears the queue.
    expect((await builds.get(decided))?.status).toBe("rejected");
    // Turning it back on accepts nothing and holds nothing that is already accepted.
    await booted.page("admin", "/settings/review", form({ reviewEnabled: "true" }));
    expect((await builds.get(waiting))?.status).toBe("approved");
  });

  it("runs the same pass when the API turns review off", async () => {
    const booted = await boot();
    const waiting = await publish(booted, "feature/x");
    await booted.api("admin", "", {
      method: "PATCH",
      body: JSON.stringify({ reviewEnabled: false }),
    });
    expect((await new BuildModel(booted.db).get(waiting))?.status).toBe("approved");
  });
});

async function withChannel(booted: Booted): Promise<void> {
  const created = await booted.api("admin", "/notification-channels", {
    method: "POST",
    body: JSON.stringify({ provider: "log", config: {} }),
  });
  expect(created.status).toBe(201);
}

const events = (booted: Booted): string => booted.sent.join("\n");

const reviewRequests = (booted: Booted): number =>
  booted.sent.filter((subject) => subject.includes("review:requested")).length;

/** Complete a publish of the build again (a repeated upload, or a retried hook). */
async function republishBuild(booted: Booted, id: string): Promise<void> {
  const upload = await booted.app.request(`/api/v1/projects/gate/builds/${id}/zip`, {
    method: "PUT",
    headers: { cookie: "storyshelf_session=dev", "content-type": "application/zip" },
    body: new Uint8Array(storybookZip(BUTTON)),
  });
  expect(upload.status).toBe(202);
}

async function postComment(booted: Booted, id: string, extra: Record<string, unknown>) {
  const response = await booted.api("dev", `/builds/${id}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: "hello", ...extra }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

const mentionsOf = async (booted: Booted, id: string) =>
  (await new CommentModel(booted.db).listByBuild(id)).map((comment) =>
    CommentModel.mentionsOf(comment).map((mention) => mention.userId),
  );
const mentionMessages = (booted: Booted): number =>
  booted.sent.filter((subject) => subject.includes("comment:mentioned")).length;

describe("review events", () => {
  it("raises review:requested for a published build that waits, not for the default branch", async () => {
    const booted = await boot();
    await withChannel(booted);
    await publish(booted, "main");
    await vi.waitFor(() => expect(events(booted)).toContain("build:created"));
    expect(events(booted)).not.toContain("review:requested");
    const id = await publish(booted, "feature/x", BUTTON, "c".repeat(40));
    await vi.waitFor(() => expect(events(booted)).toContain("review:requested"));
    expect(id).toBeTruthy();
    expect(events(booted)).toContain("review:requested on feature/x");
  });

  describe("review:requested, once per review cycle", () => {
    it("sends one request after publish and none for a repeated publish completion", async () => {
      const booted = await boot();
      await withChannel(booted);
      const id = await publish(booted, "feature/x");
      await vi.waitFor(() => expect(reviewRequests(booted)).toBe(1));
      await republishBuild(booted, id);
      await republishBuild(booted, id);
      await vi.waitFor(() => expect(booted.sent.length).toBeGreaterThan(1));
      expect(reviewRequests(booted)).toBe(1);
    });

    it("sends a new request after a genuine reopening, and none for a build that is not pending", async () => {
      const booted = await boot();
      await withChannel(booted);
      const id = await publish(booted, "feature/x");
      await vi.waitFor(() => expect(reviewRequests(booted)).toBe(1));
      const builds = new BuildModel(booted.db);
      await builds.setStatus(id, "approved");
      await republishBuild(booted, id);
      expect(reviewRequests(booted)).toBe(1);
      await builds.setStatus(id, "pending");
      await republishBuild(booted, id);
      await vi.waitFor(() => expect(reviewRequests(booted)).toBe(2));
      await republishBuild(booted, id);
      expect(reviewRequests(booted)).toBe(2);
      expect(await builds.get(id)).toMatchObject({ reviewCycle: 1, reviewRequestedCycle: 1 });
    });
  });

  it("raises no review:requested with testing on, for the publish or for a sign-off", async () => {
    const booted = await boot({ testing: true });
    await withChannel(booted);
    const id = await publish(booted, "feature/x");
    await vi.waitFor(() => expect(events(booted)).toContain("build:created"));
    const given = await booted.api("alice", `/builds/${id}/reviews`, {
      method: "POST",
      body: JSON.stringify({ verdict: "approved" }),
    });
    expect(given.status).toBe(201);
    // `review:verdict` is raised after the sign-off is stored, so a request would be in by now.
    await vi.waitFor(() => expect(events(booted)).toContain("review:verdict"));
    expect(reviewRequests(booted)).toBe(0);
  });

  it("raises build:pending when a rewritten verdict sends the build back to pending", async () => {
    const booted = await boot({ project: { reviewApprovals: 2 } });
    await withChannel(booted);
    const id = await publish(booted, "feature/x");
    const give = async (verdict: string) =>
      await booted.api("alice", `/builds/${id}/reviews`, {
        method: "POST",
        body: JSON.stringify({ verdict }),
      });
    await give("rejected");
    await vi.waitFor(() => expect(events(booted)).toContain("build:rejected"));
    expect(events(booted)).not.toContain("build:pending");
    await give("approved");
    await vi.waitFor(() => expect(events(booted)).toContain("build:pending"));
  });

  it("raises review:verdict for each verdict, and one comment:created for build and story comments", async () => {
    const booted = await boot();
    await withChannel(booted);
    const id = await publish(booted, "feature/x");
    await booted.api("alice", `/builds/${id}/reviews`, {
      method: "POST",
      body: JSON.stringify({ verdict: "approved", body: "ok" }),
    });
    await booted.api("dev", `/builds/${id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: "build level" }),
    });
    await booted.api("dev", `/builds/${id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: "story level", storyId: "card--basic" }),
    });
    await vi.waitFor(() => {
      expect(booted.sent.filter((subject) => subject.includes("review:verdict"))).toHaveLength(1);
      expect(booted.sent.filter((subject) => subject.includes("comment:created"))).toHaveLength(2);
    });
    expect(events(booted)).not.toContain("review:comment");
  });

  describe("comment:created", () => {
    type Delivery = { event: string; header: string; data: Record<string, unknown> };

    /** Webhook deliveries to one subscriber, read from the stubbed `fetch`. */
    async function deliveries(
      booted: Booted,
      subscribed: string[],
      respond: () => number = () => 200,
    ): Promise<Delivery[]> {
      await new WebhookModel(booted.db, { webhooks: booted.db.tables.webhooks }, "s").create("p1", {
        url: "https://hooks.example/in",
        secret: "whsec",
        events: subscribed,
      });
      const seen: Delivery[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: { headers: Record<string, string>; body: string }) => {
          await Promise.resolve();
          const body = JSON.parse(init.body) as { event: string; data: Record<string, unknown> };
          seen.push({
            event: body.event,
            header: init.headers["X-StoryShelf-Event"] ?? "",
            data: body.data,
          });
          return new Response("{}", { status: respond() });
        }),
      );
      return seen;
    }

    afterEach(async () => {
      // Apps stop while the stubs are still in place, as they did before teardown moved here, so a
      // pending delivery meets the fetch stub and not the network.
      try {
        await stopApps();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("emits one comment:created per comment, anchored by scope, with the event header", async () => {
      const booted = await boot();
      await withChannel(booted);
      const id = await publish(booted, "feature/x");
      const seen = await deliveries(booted, []);
      const build = await postComment(booted, id, {});
      const story = await postComment(booted, id, { storyId: "card--basic" });
      const snap = await postComment(booted, id, { snapshotId: "snap1" });
      await vi.waitFor(() => expect(seen).toHaveLength(3));
      expect(seen.map((item) => [item.event, item.header])).toEqual([
        ["comment:created", "comment:created"],
        ["comment:created", "comment:created"],
        ["comment:created", "comment:created"],
      ]);
      expect(seen.map((item) => item.data["scope"])).toEqual(["build", "story", "snapshot"]);
      expect(seen.map((item) => item.data["commentId"])).toEqual([build.id, story.id, snap.id]);
      expect(seen[1]?.data).toMatchObject({ buildId: id, storyId: "card--basic" });
      expect(seen[2]?.data).toMatchObject({ buildId: id, snapshotId: "snap1" });
      await vi.waitFor(() =>
        expect(booted.sent.filter((subject) => subject.includes("comment:created"))).toHaveLength(
          3,
        ),
      );
      expect(events(booted)).not.toContain("review:comment");
    });

    it("carries the kind of the comment, plain or change request", async () => {
      const booted = await boot();
      const id = await publish(booted, "feature/x");
      const seen = await deliveries(booted, ["comment:created"]);
      await postComment(booted, id, {});
      await postComment(booted, id, { kind: "change_request" });
      await vi.waitFor(() => expect(seen).toHaveLength(2));
      expect(seen.map((item) => item.data["kind"])).toEqual(["comment", "change_request"]);
    });

    it("keeps delivering build and story comments to a webhook that lists only review:comment", async () => {
      const booted = await boot();
      const id = await publish(booted, "feature/x");
      const seen = await deliveries(booted, ["review:comment"]);
      await postComment(booted, id, {});
      await postComment(booted, id, { storyId: "card--basic" });
      await postComment(booted, id, { snapshotId: "snap1" });
      await vi.waitFor(() => expect(seen).toHaveLength(2));
      expect(seen.map((item) => [item.event, item.header, item.data["scope"]])).toEqual([
        ["comment:created", "comment:created", "build"],
        ["comment:created", "comment:created", "story"],
      ]);
    });

    it("keeps the same event id (the comment id) when a delivery is retried", async () => {
      const booted = await boot();
      const id = await publish(booted, "feature/x");
      const statuses = [503, 200];
      const seen = await deliveries(booted, ["comment:created"], () => statuses.shift() ?? 200);
      const realSetTimeout = globalThis.setTimeout;
      vi.stubGlobal("setTimeout", (callback: () => void) => {
        callback();
        return 0;
      });
      try {
        const created = await postComment(booted, id, {});
        await vi.waitFor(() => expect(seen).toHaveLength(2));
        expect(seen.map((item) => item.data["eventId"])).toEqual([created.id, created.id]);
      } finally {
        // Teardown calls setTimeout(...).unref(), so the real timer is back before the apps stop.
        vi.stubGlobal("setTimeout", realSetTimeout);
      }
    });
    describe("mentions (#463)", () => {
      it("resolves @handles against this project's members only, and stores ids", async () => {
        const booted = await boot();
        const id = await publish(booted, "feature/x");
        const created = await postComment(booted, id, {
          body: "cc @alice and @Alice Reviewer, @view, @outsider and @admin, mail dev@example.com",
        });
        expect(await mentionsOf(booted, id)).toEqual([["alice", "view"]]);
        // Plain text stays plain and nothing about the non-members is echoed back.
        const stored = await new CommentModel(booted.db).listByBuild(id);
        expect(stored[0]?.id).toBe(created.id);
        expect(JSON.stringify(stored[0]?.mentions)).not.toMatch(/outsider|admin/u);
        // The API returns them decoded, ids and handles as typed, and names no non-member.
        const listed = (await (await booted.api("dev", `/builds/${id}/comments`)).json()) as {
          mentions: { userId: string; handle: string }[];
        }[];
        expect(listed[0]?.mentions).toEqual([
          { userId: "alice", handle: "alice" },
          { userId: "view", handle: "view" },
        ]);
      });

      it("never takes who is mentioned from the request", async () => {
        const booted = await boot();
        const id = await publish(booted, "feature/x");
        await postComment(booted, id, {
          body: "no mentions here",
          mentions: [{ userId: "alice", handle: "alice" }],
        });
        expect(await mentionsOf(booted, id)).toEqual([[]]);
      });

      it("tells the mentioned member once, with no webhook and no message to the room", async () => {
        const booted = await boot();
        const id = await publish(booted, "feature/x");
        await withChannel(booted);
        await new NotificationSubscriptionModel(booted.db).upsert("p1", "alice", {
          via: ["dm"],
          events: ["comment:created"],
        });
        const seen = await deliveries(booted, []);
        await postComment(booted, id, { body: "please look, @alice" });
        await vi.waitFor(() => expect(mentionMessages(booted)).toBe(1));
        await vi.waitFor(() => expect(seen).toHaveLength(1));
        // The room (the stored channel) gets the comment; alice, who is subscribed to comments
        // and mentioned, gets the mention instead of a second message.
        const created = booted.sent.filter((subject) => subject.includes("comment:created"));
        expect(created).toHaveLength(1);
        expect(seen.map((item) => item.event)).toEqual(["comment:created"]);
        // The payload carries the comment text as typed, but no resolved mention (no id mapping).
        expect(seen[0]?.data).not.toHaveProperty("mentions");
        expect(seen[0]?.data).not.toHaveProperty("mentionedUserId");
      });

      it("highlights a self-mention but does not notify the author", async () => {
        const booted = await boot();
        const id = await publish(booted, "feature/x");
        await new NotificationSubscriptionModel(booted.db).upsert("p1", "dev", { via: ["dm"] });
        await postComment(booted, id, { body: "note to self @dev" });
        expect(await mentionsOf(booted, id)).toEqual([["dev"]]);
        await vi.waitFor(() => expect(events(booted)).toContain("comment:created"));
        expect(mentionMessages(booted)).toBe(0);
      });
    });
  });
});

/** A page-form POST of `fields`, as HTMX sends it. */
const urlencoded = (fields: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

describe("mention suggestions and highlights (#463)", () => {
  it("offers project members matching what is typed, never a non-member", async () => {
    const booted = await boot();
    const id = await publish(booted, "feature/x");
    const suggest = async (body: string, user = "dev") =>
      await booted.page(user, `/builds/${id}/mention-suggest`, urlencoded({ body, kind: "build" }));

    const html = await (await suggest("ask @al")).text();
    expect(html).toContain("@alice");
    expect(html).toContain("Alice Reviewer");
    expect(html).toContain("mention-complete");
    // Not members of the project: never named, however they are typed.
    const typedNonMembers = await Promise.all(
      ["@out", "@outsider", "@adm", "@admin"].map(
        async (typed) => await (await suggest(`ask ${typed}`)).text(),
      ),
    );
    expect(typedNonMembers).toEqual(["", "", "", ""]);
    expect(await (await suggest("no mention here")).text()).toBe("");
    expect(await (await suggest("mail alice@example.com")).text()).toBe("");
    // Who cannot comment gets no suggestions: viewers and outsiders are turned away.
    expect((await suggest("ask @al", "view")).status).toBeGreaterThanOrEqual(400);
    expect((await suggest("ask @al", "outsider")).status).toBeGreaterThanOrEqual(400);
  });

  it("fills the chosen member's handle into the box, and refuses anyone else", async () => {
    const booted = await boot();
    const id = await publish(booted, "feature/x");
    const complete = async (pick: string) =>
      await booted.page(
        "dev",
        `/builds/${id}/mention-complete`,
        urlencoded({ body: "ask @al", kind: "story", pick }),
      );

    const ok = await complete("alice");
    expect(ok.status).toBe(200);
    const html = await ok.text();
    expect(html).toContain("story-comment-body");
    expect(html).toContain("ask @alice ");
    // A member who was not offered (not matching, or not a member) cannot be forced in, and the
    // typed text comes back untouched: the box is swapped, so an error would delete the draft.
    const refused = await Promise.all(
      ["outsider", "dev", ""].map(async (pick) => {
        const res = await complete(pick);
        return { status: res.status, text: await res.text() };
      }),
    );
    for (const { status, text } of refused) {
      expect(status).toBe(200);
      expect(text).toMatch(/<textarea[^>]*>ask @al<\/textarea>/u);
    }
  });

  it("completes a mention at the end of a long comment without losing text", async () => {
    const booted = await boot();
    const id = await publish(booted, "feature/x");
    const body = `${"a".repeat(5000)} ask @al`;
    const res = await booted.page(
      "dev",
      `/builds/${id}/mention-complete`,
      urlencoded({ body, kind: "build", pick: "alice" }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`${"a".repeat(5000)} ask @alice `);
    expect(html).not.toContain("@alice ice");
  });

  it("wires the comment boxes to the suggestions", async () => {
    const booted = await boot();
    const id = await publish(booted, "feature/x");
    const html = await (await booted.page("dev", `/builds/${id}/diff`)).text();
    expect(html).toContain(`/projects/gate/builds/${id}/mention-suggest`);
    expect(html).toContain("build-comment-body-mentions");
  });

  it("highlights a mention with the member's current name, even after a rename", async () => {
    const booted = await boot();
    const id = await publish(booted, "feature/x");
    await postComment(booted, id, { body: "please check, @alice, and mail ops@example.com" });

    const before = await (await booted.page("dev", `/builds/${id}/diff`)).text();
    expect(before).toMatch(/ss-review-mention-[^"]*">@Alice Reviewer</u);
    expect(before).toContain("mail ops@example.com");

    await booted.db.update(booted.db.tables.users, "alice", { displayNameOverride: "Al R." });
    const after = await (await booted.page("dev", `/builds/${id}/diff`)).text();
    expect(after).toMatch(/ss-review-mention-[^"]*">@Al R\.</u);
    expect(after).not.toContain("@Alice Reviewer");
  });

  it("leaves text that named no member plain", async () => {
    const booted = await boot();
    const id = await publish(booted, "feature/x");
    await postComment(booted, id, { body: "ping @outsider about this" });
    const html = await (await booted.page("dev", `/builds/${id}/diff`)).text();
    expect(html).toContain("ping @outsider about this");
    expect(html).not.toMatch(/ss-review-mention-[^"]*">@outsider</u);
  });
});
