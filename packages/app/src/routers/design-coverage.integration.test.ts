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

const text = async (response: Response | Promise<Response>) => await (await response).text();
const ADMIN_TOKEN = "admin-token-0123456789-abcdef";
const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
const as = (who: string) => ({ headers: { cookie: `storyshelf_session=${who}` } });

describe("design coverage page", () => {
  it("lists components with no design link, and not the hand-mapped one", async () => {
    const { app } = await seed();
    const page = await text(app.request(URL_PATH));
    const section = page.slice(
      page.indexOf("No design link"),
      page.indexOf("Design changed or deleted"),
    );
    expect(section).toContain("No design link (2)");
    for (const name of ["Card", "Modal"]) {
      expect(section).toContain(`Kit/${name}`);
      expect(section).toContain(`>src/${name}.stories.tsx<`);
    }
    for (const name of ["Button", "Tag", "Input", "Menu"]) {
      expect(section).not.toContain(`Kit/${name}`);
    }
  });

  it("lists linked components whose design changed after the baseline, or was deleted", async () => {
    const { app } = await seed();
    const page = await text(app.request(URL_PATH));
    const section = page.slice(
      page.indexOf("Design changed or deleted"),
      page.indexOf("Up to date"),
    );
    expect(section).toContain("Design changed or deleted (2)");
    expect(section).toContain("Kit/Button");
    expect(section).toContain("Design changed");
    expect(section).toContain("Kit/Tag");
    expect(section).toContain("Design deleted");
    expect(section).toContain(`href="${BUTTON}"`);
    expect(section).not.toContain("Kit/Input");
  });

  it("counts linked components that are up to date, and those with no stored status", async () => {
    const { app } = await seed();
    const page = await text(app.request(URL_PATH));
    const section = page.slice(page.indexOf("Up to date"));
    expect(section).toContain("Up to date (1)");
    expect(section).toContain("1 linked component is up to date");
    expect(section).toContain(
      "1 more has a link but nothing stored says whether the design changed",
    );
  });

  it("compares with the current baseline, not the one the snapshot was diffed against", async () => {
    // Input changed (2025-12) after the baseline the snapshots were diffed against (2025-06) but
    // before the baseline promoted since (2026-01), so the approved screenshot already shows it.
    const { app } = await seed();
    const page = await text(app.request(URL_PATH));
    const changed = page.slice(
      page.indexOf("Design changed or deleted"),
      page.indexOf("Up to date"),
    );
    expect(changed).not.toContain("Kit/Input");
    expect(page.slice(page.indexOf("Up to date"))).toContain("Up to date (1)");
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
    const page = await text(app.request(URL_PATH));
    const changed = page.slice(
      page.indexOf("Design changed or deleted"),
      page.indexOf("Up to date"),
    );
    expect(changed).toContain("Design changed or deleted (3)");
    expect(changed).toContain("Kit/Input");
  });

  it("counts a hand-mapped component as linked, not as missing a design", async () => {
    const { app } = await seed();
    const page = await text(app.request(URL_PATH));
    expect(page).toContain("With a design link");
    expect(page).not.toMatch(
      /No design link \(\d+\)[\s\S]*Kit\/Menu[\s\S]*Design changed or deleted/u,
    );
  });

  it("says why design status is unavailable when the project has no token", async () => {
    const { app } = await seed({ token: false });
    const page = await text(app.request(URL_PATH));
    expect(page).toContain("Design status is unavailable for some links");
    expect(page).toContain("Figma has no token for this project");
    // What the cache holds is not trusted without a token: nothing is reported as drifted.
    expect(page).toContain("Design changed or deleted (0)");
    expect(page).not.toContain("Design deleted");
  });

  it("does not warn about a missing token when the project has one", async () => {
    const { app } = await seed();
    expect(await text(app.request(URL_PATH))).not.toContain("Design status is unavailable");
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
      expect(page).toContain("No accepted build yet");
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
    expect(page).toContain("No design link (5)");
    expect(page).not.toContain(">Kit/Menu<");
    // Without snapshots nothing was compared with a baseline, so no link counts as up to date.
    expect(page).toContain("Up to date (0)");
  });

  it("ignores retained baselines when testing is off", async () => {
    // The seed holds baselines for every story; without testing none of them is compared.
    const { app } = await seed({ testing: false });
    const page = await text(app.request(URL_PATH));
    const changed = page.slice(
      page.indexOf("Design changed or deleted"),
      page.indexOf("Up to date"),
    );
    expect(changed).not.toContain("Kit/Button");
    expect(page).toContain("Up to date (0)");
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
