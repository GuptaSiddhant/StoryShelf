import { DesignCredentialModel, DesignModel, MemberModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { storybookDir } from "@storyshelf/core/utils";
import { createFigmaDesign } from "@storyshelf/design-figma";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { PAGE_ROUTE_CLASSES } from "../routes/page-routes.ts";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

const SECRET = "coverage-test-secret";
const NOW = "2026-01-01T00:00:00.000Z";
/** When the current baselines were approved. */
const BASELINE = "2026-01-01T00:00:00.000Z";
/** The older baseline the snapshots were diffed against, before promotion replaced it. */
const DIFFED_AGAINST = "2025-06-01T00:00:00.000Z";
const URL_PATH = "/projects/app/design/coverage";
const figma = createFigmaDesign();

afterEach(() => vi.restoreAllMocks());

const BUTTON = "https://www.figma.com/design/KEY/Kit?node-id=1-2";
const TAG = "https://www.figma.com/design/TAG/Kit";
const INPUT = "https://www.figma.com/design/INP/Kit?node-id=3-4";
const MENU = "https://www.figma.com/design/MENU/Kit?node-id=5-6";

/** Story files, in index order; a design URL on a file means its stories declare that link. */
const FILES: { name: string; url?: string }[] = [
  { name: "Button", url: BUTTON },
  { name: "Card" },
  { name: "Tag", url: TAG },
  { name: "Input", url: INPUT },
  { name: "Menu" },
  { name: "Modal" },
];

const entry = (name: string) => ({
  id: `${name.toLowerCase()}--default`,
  title: `Kit/${name}`,
  name: "Default",
  importPath: `./src/${name}.stories.tsx`,
  type: "story",
});

interface Options {
  providers?: boolean;
  token?: boolean;
  build?: "approved" | "pending" | "none";
  auth?: boolean;
  testing?: boolean;
}

/** The approved default-branch baseline of each story, promoted after the snapshots were diffed. */
async function seedBaselines(db: ReturnType<typeof makeDatabase>["db"]): Promise<void> {
  await Promise.all(
    FILES.map(
      async (file) =>
        await db.insert(db.tables.baselines, {
          id: `base-${file.name}`,
          projectId: "p1",
          storyId: entry(file.name).id,
          viewportName: "default",
          branch: "main",
          browser: "chromium",
          screenshotPath: `p1/${file.name}.png`,
          createdAt: BASELINE,
          updatedAt: BASELINE,
        } as never),
    ),
  );
}

async function seedNodes(db: ReturnType<typeof makeDatabase>["db"]): Promise<void> {
  const node = (id: string, fileKey: string, nodeId: string, extra: Record<string, unknown>) =>
    db.insert(db.tables.designNodes, {
      id,
      projectId: "p1",
      provider: "figma",
      viewerId: "",
      fileKey,
      nodeId,
      name: id,
      version: "1",
      lastModified: "2025-12-01T00:00:00.000Z",
      state: "ok",
      renderPath: null,
      renderVersion: null,
      fetchedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      ...extra,
    } as never);
  // Changed after the baseline was approved.
  await node("Button node", "KEY", "1:2", { lastModified: "2026-02-01T00:00:00.000Z" });
  await node("Tag file", "TAG", "", { state: "deleted", lastModified: null });
  await node("Input node", "INP", "3:4", {});
}

async function seed(options: Options = {}) {
  const {
    providers = true,
    token = true,
    build = "approved",
    auth = false,
    testing = true,
  } = options;
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "App",
    slug: "app",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  if (build !== "none") {
    await db.insert(db.tables.builds, {
      id: "b1",
      projectId: "p1",
      gitSha: "abc1234",
      gitBranch: "main",
      isDefault: true,
      status: build,
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
    objects.set(
      `${storybookDir("p1", "b1")}/index.json`,
      Buffer.from(
        JSON.stringify({
          v: 5,
          entries: Object.fromEntries(FILES.map((file) => [entry(file.name).id, entry(file.name)])),
        }),
      ),
    );
    await Promise.all(
      FILES.map(
        async (file) =>
          await db.insert(db.tables.snapshots, {
            id: `snap-${file.name}`,
            projectId: "p1",
            buildId: "b1",
            storyId: entry(file.name).id,
            storyName: "Default",
            storyTitle: `Kit/${file.name}`,
            storyImportPath: `./src/${file.name}.stories.tsx`,
            screenshotPath: `p1/${file.name}.png`,
            status: "unchanged",
            baselineVersion: DIFFED_AGAINST,
            designUrl: file.url ?? null,
            createdAt: NOW,
            updatedAt: NOW,
          } as never),
      ),
    );
  }
  await seedBaselines(db);
  await seedNodes(db);
  const admin = { id: "u-admin", email: "a@x.io", name: "Ada", role: "admin" as const };
  const viewer = { id: "u-viewer", email: "v@x.io", name: "Vee", role: "member" as const };
  const outsider = { id: "u-out", email: "o@x.io", name: "Out", role: "member" as const };
  const users = { admin, viewer, outsider };
  const stub = stubAuth(null, {
    check: async (request: Request) => {
      await Promise.resolve();
      const cookie = request.headers.get("cookie") ?? "";
      return (
        Object.entries(users).find(([key]) => cookie.includes(`storyshelf_session=${key}`))?.[1] ??
        null
      );
    },
  });
  await new MemberModel(db).set("p1", viewer.id, "viewer");
  // Menu has no story-declared link: it is mapped by hand.
  await new DesignModel(db, [figma]).setComponentLink("p1", "./src/Menu.stories.tsx", MENU);
  if (token) await new DesignCredentialModel(db, SECRET).set("p1", "figma", "figd_token");
  const app = createShelfApp({
    ...(testing ? { testing: { runner: stubRunner() } } : {}),
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    config: { secret: SECRET, ...(auth ? { adminToken: ADMIN_TOKEN } : {}) },
    ...(providers ? { design: [figma] } : {}),
    ...(auth ? { auth: stub } : {}),
  });
  return { app, db };
}

/** The part of the page between two section anchors (or to the end). */
const between = (page: string, from: string, to?: string): string =>
  page.slice(page.indexOf(`id="${from}"`), to ? page.indexOf(`id="${to}"`) : undefined);

const text = async (response: Response | Promise<Response>) => await (await response).text();
const ADMIN_TOKEN = "admin-token-0123456789-abcdef";
const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
const as = (who: string) => ({ headers: { cookie: `storyshelf_session=${who}` } });

describe("design coverage page", () => {
  it("lists components with no design link, and not the hand-mapped one", async () => {
    const { app } = await seed();
    const page = await text(app.request(URL_PATH));
    const section = between(page, "no-link", "drift");
    expect(section).toContain("No design link (2)");
    for (const name of ["Card", "Modal"]) {
      expect(section).toContain(`Kit/${name}`);
      expect(section).toContain(`>src/${name}.stories.tsx<`);
    }
    for (const name of ["Button", "Tag", "Input", "Menu"]) {
      expect(section).not.toContain(`Kit/${name}`);
    }
  });

  it("sends each unlinked component to its Design tab, with a labelled action", async () => {
    const { app } = await seed();
    const section = between(await text(app.request(URL_PATH)), "no-link", "drift");
    expect(section).toContain('aria-label="Link a design to Kit/Card"');
    expect(section).toContain("/projects/app/components/src/Card.stories.tsx?tab=design");
    expect(section).toContain("Link a design");
  });

  it("anchors the three stats to their sections, in the spec's words", async () => {
    const { app } = await seed();
    const page = await text(app.request(URL_PATH));
    for (const id of ["no-link", "drift", "current"]) {
      expect(page).toContain(`href="#${id}"`);
      expect(page).toContain(`id="${id}"`);
    }
    for (const label of ["No design link", "Needs attention", "Up to date"]) {
      expect(page).toContain(label);
    }
    expect(page).not.toContain("With a design link");
  });

  it("lists linked components whose design changed after the baseline, or was deleted", async () => {
    const { app } = await seed();
    const page = await text(app.request(URL_PATH));
    const section = between(page, "drift", "current");
    expect(section).toContain("Needs attention (2)");
    expect(section).toContain("Kit/Button");
    expect(section).toContain("Design changed");
    expect(section).toContain('title="Design changed after approval"');
    expect(section).toContain("Kit/Tag");
    expect(section).toContain('title="Design file deleted"');
    expect(section).toContain(`href="${BUTTON}"`);
    expect(section).not.toContain("Kit/Input");
    // Deleted designs come first.
    expect(section.indexOf("Kit/Tag")).toBeLessThan(section.indexOf("Kit/Button"));
  });

  it("says when the design changed and when the designs were last checked", async () => {
    const { app } = await seed();
    const section = between(await text(app.request(URL_PATH)), "drift", "current");
    expect(section).toContain('datetime="2026-02-01T00:00:00.000Z"');
    expect(section).toContain("Last checked");
    expect(section).toContain(`datetime="${NOW}"`);
  });

  it("counts linked components that are up to date, and those with no stored status", async () => {
    const { app } = await seed();
    const section = between(await text(app.request(URL_PATH)), "current");
    expect(section).toContain("1 component is linked and matches their approved design.");
    expect(section).toContain(
      "1 more has a link but nothing stored says whether the design changed",
    );
  });

  it("compares with the current baseline, not the one the snapshot was diffed against", async () => {
    // Input changed (2025-12) after the baseline the snapshots were diffed against (2025-06) but
    // before the baseline promoted since (2026-01), so the approved screenshot already shows it.
    const { app } = await seed();
    const page = await text(app.request(URL_PATH));
    expect(between(page, "drift", "current")).not.toContain("Kit/Input");
    expect(between(page, "current")).toContain("1 component is linked");
  });

  it("reports drift when any baseline of the component predates the design change", async () => {
    // Input has a January baseline and, for another viewport, a November one: the design changed
    // (December) after the older screenshot was approved.
    const { app, db } = await seed();
    await db.insert(db.tables.baselines, {
      id: "base-Input-mobile",
      projectId: "p1",
      storyId: entry("Input").id,
      viewportName: "mobile",
      branch: "main",
      browser: "chromium",
      screenshotPath: "p1/Input-mobile.png",
      createdAt: "2025-11-01T00:00:00.000Z",
      updatedAt: "2025-11-01T00:00:00.000Z",
    } as never);
    const changed = between(await text(app.request(URL_PATH)), "drift", "current");
    expect(changed).toContain("Needs attention (3)");
    expect(changed).toContain("Kit/Input");
  });

  it("counts a hand-mapped component as linked, not as missing a design", async () => {
    const { app } = await seed();
    const page = await text(app.request(URL_PATH));
    expect(between(page, "no-link", "drift")).not.toContain("Kit/Menu");
  });

  it("does not claim drift was checked when the project has no token", async () => {
    const { app } = await seed({ token: false });
    const page = await text(app.request(URL_PATH));
    const drift = between(page, "drift", "current");
    expect(drift).toContain("Drift can&#39;t be checked");
    expect(drift).toContain("Figma has no access token for this project");
    expect(drift).toContain("Open design settings");
    expect(drift).toContain("/projects/app/settings/capture#design");
    // No all-clear, no count: the answer is unknown, not zero.
    expect(drift).not.toContain("Needs attention (");
    expect(drift).not.toContain("No drift found");
    expect(drift).not.toContain("Last checked");
    expect(page).toContain("Needs attention · Unavailable");
    expect(page).not.toContain("Design file deleted");
    // Nothing is called up to date either: only the unknown links are mentioned.
    const current = between(page, "current");
    expect(current).not.toContain("linked and match");
    expect(current).toContain("have a link but nothing stored says whether the design changed");
  });

  it("does not warn about a missing token when the project has one", async () => {
    const { app } = await seed();
    const page = await text(app.request(URL_PATH));
    expect(page).not.toContain("can&#39;t be checked");
    expect(page).not.toContain("Open design settings");
  });

  it("makes no design provider call while rendering", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const { app } = await seed();
    await app.request(URL_PATH);
    const calls = spy.mock.calls.map(([input]) =>
      input instanceof Request ? input.url : String(input),
    );
    expect(calls.filter((url) => url.includes("figma.com"))).toEqual([]);
  });

  it.each(["none", "pending"] as const)(
    "says there is nothing to read when the only build is %s",
    async (build) => {
      const { app } = await seed({ build });
      const page = await text(app.request(URL_PATH));
      expect(page).toContain("No build to check yet");
      expect(page).toContain("Go to builds");
      expect(page).toContain('href="/projects/app/builds"');
      expect(page).not.toContain("No design link (");
    },
  );
});

describe("design coverage page gating", () => {
  it("is not there without a configured design provider, or for an unknown project", async () => {
    const { app } = await seed({ providers: false });
    expect((await app.request(URL_PATH)).status).toBe(404);
    const { app: withProvider } = await seed();
    expect((await withProvider.request("/projects/nope/design/coverage")).status).toBe(404);
  });

  it("is visible to project members and 404 for everyone else", async () => {
    const { app } = await seed({ auth: true });
    expect((await app.request(URL_PATH, as("viewer"))).status).toBe(200);
    expect((await app.request(URL_PATH, as("admin"))).status).toBe(200);
    expect((await app.request(URL_PATH, as("outsider"))).status).toBe(404);
  });

  it("sends anonymous requests to sign in, whatever bearer token they carry", async () => {
    // Pages sit behind the session gate: a bearer token opens `/api/v1`, not this page.
    const { app } = await seed({ auth: true });
    const requests = [undefined, bearer("wrong-token"), bearer(ADMIN_TOKEN)];
    const responses = await Promise.all(
      requests.map(async (init) => await app.request(URL_PATH, init)),
    );
    expect(responses.map((response) => response.status)).toEqual([302, 302, 302]);
    expect(responses[0]?.headers.get("location")).toContain("login");
  });

  it("is 404 to a member of a different project", async () => {
    const { app, db } = await seed({ auth: true });
    await db.insert(db.tables.projects, {
      id: "p2",
      name: "Other",
      slug: "other",
      gitDefaultBranch: "main",
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
    await new MemberModel(db).set("p2", "u-out", "admin");
    expect((await app.request(URL_PATH, as("outsider"))).status).toBe(404);
    expect((await app.request(URL_PATH, as("viewer"))).status).toBe(200);
  });

  it("is a hosting route: it works without testing, counting only mapped links", async () => {
    expect(PAGE_ROUTE_CLASSES["GET /projects/:slug/design/coverage"]).toBe("hosting");
    const { app } = await seed({ testing: false });
    const response = await app.request(URL_PATH);
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain("Only mapped design links are counted");
    // Story-declared links need captured snapshots; the hand-mapped Menu is still linked.
    const unlinked = between(page, "no-link", "drift");
    expect(unlinked).toContain("No design link (5)");
    expect(unlinked).not.toContain(">Kit/Menu<");
    // Without testing a component has no Design tab, so linking goes to the project's settings.
    expect(unlinked).toContain("/projects/app/settings/capture#design");
    expect(unlinked).not.toContain("?tab=design");
    // Without snapshots nothing was compared with a baseline, so no link counts as up to date.
    expect(between(page, "current")).not.toContain("linked and match");
  });

  it("ignores retained baselines when testing is off", async () => {
    // The seed holds baselines for every story; without testing none of them is compared.
    const { app } = await seed({ testing: false });
    const page = await text(app.request(URL_PATH));
    expect(between(page, "drift", "current")).not.toContain("Kit/Button");
    expect(between(page, "current")).not.toContain("linked and match");
  });

  it("does not say links are skipped when testing reads them", async () => {
    const { app } = await seed();
    expect(await text(app.request(URL_PATH))).not.toContain("Only mapped design links are counted");
  });
});

describe("library link to design coverage", () => {
  it("is offered when a design provider is configured, and not otherwise", async () => {
    const { app } = await seed();
    expect(await text(app.request("/projects/app/library"))).toContain(`href="${URL_PATH}"`);
    const { app: plain } = await seed({ providers: false });
    expect(await text(plain.request("/projects/app/library"))).not.toContain(URL_PATH);
  });
});
