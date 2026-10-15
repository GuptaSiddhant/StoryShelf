import { DesignCredentialModel, DesignModel, MemberModel } from "@storyshelf/core/models";
import type { DesignNode } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { createFigmaDesign } from "@storyshelf/design-figma";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubAuth } from "../stub-auth.ts";

const SECRET = "design-test-secret";
const figma = createFigmaDesign();
const NOW = "2026-01-01T00:00:00.000Z";
const BUTTON_FIGMA = "https://www.figma.com/design/KEY/Kit?node-id=1-2";
const CARD_FIGMA = "https://www.figma.com/design/OTHER/Kit";

afterEach(() => vi.restoreAllMocks());

async function seed() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "App",
    slug: "app",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  await db.insert(db.tables.builds, {
    id: "b1",
    projectId: "p1",
    gitSha: "abc1234",
    gitBranch: "main",
    isDefault: true,
    status: "approved",
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  const snap = (id: string, file: string, extra: Record<string, unknown> = {}) =>
    db.insert(db.tables.snapshots, {
      id,
      projectId: "p1",
      buildId: "b1",
      storyId: id,
      storyName: id,
      storyTitle: file,
      storyImportPath: `./src/${file}.stories.tsx`,
      screenshotPath: `p1/${id}.png`,
      status: "changed",
      baselineVersion: "2026-01-01T00:00:00.000Z",
      createdAt: NOW,
      updatedAt: NOW,
      ...extra,
    } as never);
  await snap("button-primary", "Button", { designUrl: BUTTON_FIGMA });
  await snap("button-secondary", "Button", { designUrl: BUTTON_FIGMA });
  await snap("card-default", "Card");
  await snap("tag-default", "Tag", { designUrl: "https://www.figma.com/design/TAG/Kit" });
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    design: [figma],
    config: { secret: SECRET },
  });
  return {
    db,
    app,
    design: new DesignModel(db, [figma]),
    credentials: new DesignCredentialModel(db, SECRET),
  };
}

function post(body: Record<string, string>) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-csrf-token": getCsrfToken(SECRET),
    },
    body: new URLSearchParams(body).toString(),
  } as const;
}

function figmaApi(handler: (url: string) => Response): ReturnType<typeof vi.spyOn> {
  const real = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.startsWith("https://api.figma.com/") || url.startsWith("https://cdn.example.com/")
      ? handler(url)
      : await real(input, init);
  });
}

describe("design settings", () => {
  it("manages design files, component mappings and the write-only token", async () => {
    const { app, design, credentials } = await seed();
    const page = await (await app.request("/projects/app/settings/design")).text();
    expect(page).toContain("Design files");
    expect(page).toContain("No design files linked.");
    expect(page).toContain("Component mapping");

    const file = await app.request(
      "/projects/app/settings/design/files",
      post({ label: "Kit", url: CARD_FIGMA }),
    );
    expect([204, 302]).toContain(file.status);
    expect(await design.projectLinks("p1")).toMatchObject([{ label: "Kit", url: CARD_FIGMA }]);

    await app.request(
      "/projects/app/settings/design/components",
      post({ importPath: "./src/Card.stories.tsx", url: CARD_FIGMA }),
    );
    expect(await design.componentLinks("p1")).toMatchObject([
      { importPath: "src/Card.stories.tsx", url: CARD_FIGMA },
    ]);

    await app.request(
      "/projects/app/settings/design/figma/token",
      post({ token: "figd_secret_value" }),
    );
    const withToken = await (await app.request("/projects/app/settings/design")).text();
    expect(withToken).toContain("Not used yet");
    expect(withToken).not.toContain("figd_secret_value");
    expect(await credentials.get("p1", "figma")).toBe("figd_secret_value");

    await app.request("/projects/app/settings/design/figma/token/delete", post({}));
    expect(await credentials.info("p1", "figma")).toBeNull();

    const [link] = await design.componentLinks("p1");
    await app.request(`/projects/app/settings/design/components/${link?.id}/delete`, post({}));
    expect(await design.componentLinks("p1")).toEqual([]);
    const [project] = await design.projectLinks("p1");
    await app.request(`/projects/app/settings/design/files/${project?.id}/delete`, post({}));
    expect(await design.projectLinks("p1")).toEqual([]);
  });

  it("rejects non-Figma urls and blank values with 400", async () => {
    const { app, design } = await seed();
    const badFile = await app.request(
      "/projects/app/settings/design/files",
      post({ label: "x", url: "https://example.com/x" }),
    );
    expect(badFile.status).toBe(400);
    expect(await badFile.text()).toContain("Enter a supported design link");
    const badComponent = await app.request(
      "/projects/app/settings/design/components",
      post({ importPath: "a.tsx", url: "nope" }),
    );
    expect(badComponent.status).toBe(400);
    const noPath = await app.request(
      "/projects/app/settings/design/components",
      post({ importPath: "", url: CARD_FIGMA }),
    );
    expect(noPath.status).toBe(400);
    const noToken = await app.request(
      "/projects/app/settings/design/figma/token",
      post({ token: "" }),
    );
    expect(noToken.status).toBe(400);
    expect(await design.projectLinks("p1")).toEqual([]);
    expect(await design.componentLinks("p1")).toEqual([]);
  });
});

describe("design surfaces", () => {
  it("shows Figma actions only for components that resolve a link, plus project links", async () => {
    const { app, design } = await seed();
    await design.addProjectLink("p1", { label: "Design system", url: CARD_FIGMA });
    await design.setComponentLink(
      "p1",
      "./src/Tag.stories.tsx",
      "https://www.figma.com/design/MANUAL/Tag",
    );
    const html = await (await app.request("/projects/app/library")).text();
    expect(html).toContain("Design system");
    expect(html).toContain(BUTTON_FIGMA.replace("&", "&amp;"));
    expect(html).toContain("https://www.figma.com/design/MANUAL/Tag");
    expect(html).not.toContain("https://www.figma.com/design/TAG/Kit");
    // Button ×2 states + Tag; Card has none.
    expect(html.match(/>Figma</gu)).toHaveLength(3);

    const detail = await (await app.request("/projects/app/builds/b1")).text();
    expect(detail.match(/>Figma</gu)).toHaveLength(3);
  });

  it("shows nothing on the review page without a link", async () => {
    const { app } = await seed();
    const html = await (
      await app.request("/projects/app/builds/b1/diff?snapshot=card-default")
    ).text();
    expect(html).not.toContain("Open in Figma");
  });

  it("degrades to a plain deep link without a token", async () => {
    const { app } = await seed();
    const spy = figmaApi(() => new Response("{}"));
    const html = await (
      await app.request("/projects/app/builds/b1/diff?snapshot=button-primary")
    ).text();
    expect(html).toContain("Open in Figma");
    expect(html).not.toContain("Design changed");
    expect(spy).not.toHaveBeenCalled();
  });

  it("flags a design edited after the baseline, using cached metadata", async () => {
    const { app, credentials } = await seed();
    await credentials.set("p1", "figma", "figd_tok");
    figmaApi(() =>
      Response.json({
        name: "Kit",
        version: "9",
        lastModified: "2026-02-01T00:00:00Z",
        nodes: { "1:2": { document: { name: "Button" } } },
      }),
    );
    const html = await (
      await app.request("/projects/app/builds/b1/diff?snapshot=button-primary")
    ).text();
    expect(html).toContain("Open in Figma");
    expect(html).toContain("Design changed since this baseline was approved");
    expect(html).toContain("Button");
    expect((await credentials.info("p1", "figma"))?.status).toBe("ok");
  });

  it("reports a deleted node without blocking review", async () => {
    const { app, credentials } = await seed();
    await credentials.set("p1", "figma", "figd_tok");
    figmaApi(() => Response.json({ name: "Kit", nodes: { "1:2": null } }));
    const gone = await (
      await app.request("/projects/app/builds/b1/diff?snapshot=button-primary")
    ).text();
    expect(gone).toContain("Design not found");
    expect(gone).toContain("Open in Figma");
  });

  it("reports an expired token without blocking review", async () => {
    const { app, credentials } = await seed();
    await credentials.set("p1", "figma", "figd_tok");
    figmaApi(() => new Response("{}", { status: 401 }));
    const expired = await (
      await app.request("/projects/app/builds/b1/diff?snapshot=button-primary")
    ).text();
    expect(expired).toContain("expired or revoked");
    expect(expired).toContain("Open in Figma");
  });
});

describe("design renders", () => {
  const PNG = Buffer.from([137, 80, 78, 71]);
  const withRender = (version = "7"): ReturnType<typeof vi.spyOn> =>
    figmaApi((url) => {
      if (url.includes("/images/")) {
        return Response.json({ images: { "1:2": "https://cdn.example.com/r.png" } });
      }
      if (url.startsWith("https://cdn.example.com/")) return new Response(PNG);
      return Response.json({
        name: "Kit",
        version,
        lastModified: "2025-12-01T00:00:00Z",
        nodes: { "1:2": { document: { name: "Button" } } },
      });
    });

  it("shows the cached render as a reference pane and serves it to viewers", async () => {
    const { app, credentials } = await seed();
    await credentials.set("p1", "figma", "figd_tok");
    withRender();
    const html = await (
      await app.request("/projects/app/builds/b1/diff?snapshot=button-primary")
    ).text();
    expect(html).toContain("Figma reference");
    const src = /src="(\/api\/v1\/projects\/app\/design\/renders\/[^"]+)"/u.exec(html)?.[1];
    expect(src).toBeDefined();
    const image = await app.request((src ?? "").replaceAll("&amp;", "&"));
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await image.arrayBuffer())).toEqual(PNG);
  });

  it("404s for unknown render ids and renders from other projects", async () => {
    const { app } = await seed();
    expect((await app.request("/api/v1/projects/app/design/renders/missing")).status).toBe(404);
  });

  it("offers a click popover with the cached render in the library", async () => {
    const { app, credentials } = await seed();
    await credentials.set("p1", "figma", "figd_tok");
    withRender();
    await app.request("/projects/app/builds/b1/diff?snapshot=button-primary");
    const html = await (await app.request("/projects/app/library")).text();
    expect(html).toContain("data-dropdown");
    expect(html).toContain("Figma design: Button");
    expect(html).toContain("Open in Figma");
  });

  it("shows no reference pane without a render", async () => {
    const { app } = await seed();
    const html = await (
      await app.request("/projects/app/builds/b1/diff?snapshot=button-primary")
    ).text();
    expect(html).not.toContain("Figma reference");
  });
});

const asUser = (session: string, body: Record<string, string>) =>
  ({
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `storyshelf_session=${session}`,
      "x-csrf-token": getCsrfToken(SECRET, session),
    },
    body: new URLSearchParams(body).toString(),
  }) as const;

describe("design settings authorization", () => {
  const admin = { id: "u-admin", email: "a@x.io", name: "Ada", role: "admin" as const };
  const dev = { id: "u-dev", email: "d@x.io", name: "Dev", role: "member" as const };
  const auth = stubAuth(null, {
    check: async (request: Request) => {
      await Promise.resolve();
      const cookie = request.headers.get("cookie") ?? "";
      if (cookie.includes("storyshelf_session=admin")) return admin;
      if (cookie.includes("storyshelf_session=dev")) return dev;
      return null;
    },
  });

  async function authed() {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(db.tables.projects, {
      id: "p1",
      name: "App",
      slug: "app",
      gitRepository: null,
      gitDefaultBranch: "main",
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
    await Promise.all(
      [admin, dev].map(
        async (user) =>
          await db.insert(db.tables.users, {
            ...user,
            avatarUrl: null,
            lastLoginAt: null,
            createdAt: NOW,
          } as never),
      ),
    );
    await new MemberModel(db).set("p1", dev.id, "developer");
    const app = createShelfApp({
      database: db,
      storage,
      auth,
      logger: pino({ level: "silent" }),
      design: [figma],
      config: { secret: SECRET },
    });
    const design = new DesignModel(db, [figma]);
    const credentials = new DesignCredentialModel(db, SECRET);
    await credentials.set("p1", "figma", "figd_original");
    await design.setComponentLink("p1", "a.tsx", CARD_FIGMA);
    return { app, design, credentials };
  }

  const BASE = "/projects/app/settings/design";

  it("rejects non-admin members from every credential and mapping mutation", async () => {
    const { app, design, credentials } = await authed();
    const [link] = await design.componentLinks("p1");
    const attempts: [string, Record<string, string>][] = [
      [`${BASE}/figma/token`, { token: "figd_hijack" }],
      [`${BASE}/figma/token/delete`, {}],
      [`${BASE}/files`, { label: "x", url: CARD_FIGMA }],
      [`${BASE}/components`, { importPath: "b.tsx", url: CARD_FIGMA }],
      [`${BASE}/components/${link?.id}/delete`, {}],
      [`${BASE}/files/${link?.id}/delete`, {}],
    ];
    const responses = await Promise.all(
      attempts.map(async ([path, body]) => await app.request(path, asUser("dev", body))),
    );
    expect(responses.map((res) => res.status)).toEqual(attempts.map(() => 403));
    expect(await credentials.get("p1", "figma")).toBe("figd_original");
    expect(await design.componentLinks("p1")).toHaveLength(1);
    expect(await design.projectLinks("p1")).toEqual([]);
  });

  it("rejects unauthenticated mutations", async () => {
    const { app, credentials } = await authed();
    const res = await app.request(
      `${BASE}/figma/token`,
      asUser("nobody", { token: "figd_hijack" }),
    );
    expect([302, 401, 403]).toContain(res.status);
    expect(await credentials.get("p1", "figma")).toBe("figd_original");
  });

  it("still lets an admin rotate the token and manage mappings", async () => {
    const { app, design, credentials } = await authed();
    const rotated = await app.request(
      `${BASE}/figma/token`,
      asUser("admin", { token: "figd_new" }),
    );
    expect([204, 302]).toContain(rotated.status);
    expect(await credentials.get("p1", "figma")).toBe("figd_new");
    const mapped = await app.request(
      `${BASE}/components`,
      asUser("admin", { importPath: "b.tsx", url: CARD_FIGMA }),
    );
    expect([204, 302]).toContain(mapped.status);
    expect(await design.componentLinks("p1")).toHaveLength(2);
  });
});

const reviewHtml = async (app: Awaited<ReturnType<typeof seed>>["app"]): Promise<string> =>
  await (await app.request("/projects/app/builds/b1/diff?snapshot=button-primary")).text();

describe("design hardening", () => {
  const PNG = Buffer.from([137, 80, 78, 71]);
  const apiWith = (nodes: Record<string, unknown>, version = "7"): ReturnType<typeof vi.spyOn> =>
    figmaApi((url) => {
      if (url.includes("/images/")) {
        return Response.json({ images: { "1:2": "https://cdn.example.com/r.png" } });
      }
      if (url.startsWith("https://cdn.example.com/")) return new Response(PNG);
      return Response.json({ name: "Kit", version, lastModified: "2025-12-01T00:00:00Z", nodes });
    });

  it("counts the rotation clock from when the token was set, not from refreshes", async () => {
    const { app, db, credentials } = await seed();
    await credentials.set("p1", "figma", "figd_tok");
    const row = await credentials.info("p1", "figma");
    const eightyDaysAgo = new Date(Date.now() - 80 * 86_400_000).toISOString();
    await db.update(db.tables.designCredentials, row?.id ?? "", {
      createdAt: eightyDaysAgo,
    } as never);
    apiWith({ "1:2": { document: { name: "Button" } } });
    await reviewHtml(app);
    expect((await credentials.info("p1", "figma"))?.status).toBe("ok");
    const page = await (await app.request("/projects/app/settings/design")).text();
    expect(page).toMatch(/Rotate within (?:9|10) days/u);
  });

  it("stops showing a render once the node is deleted", async () => {
    const { app, db, credentials } = await seed();
    await credentials.set("p1", "figma", "figd_tok");
    apiWith({ "1:2": { document: { name: "Button" } } });
    const withPane = await reviewHtml(app);
    expect(withPane).toContain("Figma reference");
    const [node] = (await db.list(db.tables.designNodes)) as unknown as DesignNode[];
    await db.update(db.tables.designNodes, node?.id ?? "", { fetchedAt: NOW } as never);
    apiWith({ "1:2": null });
    const gone = await reviewHtml(app);
    expect(gone).toContain("Design not found");
    expect(gone).not.toContain("Figma reference");
    expect((await app.request(`/api/v1/projects/app/design/renders/${node?.id}`)).status).toBe(404);
  });

  it("caches versioned renders as immutable and unversioned ones briefly", async () => {
    const { app, db, credentials } = await seed();
    await credentials.set("p1", "figma", "figd_tok");
    apiWith({ "1:2": { document: { name: "Button" } } });
    await reviewHtml(app);
    const [node] = (await db.list(db.tables.designNodes)) as unknown as DesignNode[];
    const base = `/api/v1/projects/app/design/renders/${node?.id}`;
    const versioned = await app.request(`${base}?v=${node?.renderVersion}`);
    expect(versioned.headers.get("cache-control")).toContain("immutable");
    const plain = await app.request(base);
    expect(plain.headers.get("cache-control")).toBe("private, max-age=3600");
    const stale = await app.request(`${base}?v=old`);
    expect(stale.headers.get("cache-control")).toBe("private, max-age=3600");
  });

  it("refreshes at most ten design links, three files at a time, when the library loads", async () => {
    const { app, db, credentials } = await seed();
    await credentials.set("p1", "figma", "figd_tok");
    await Promise.all(
      Array.from({ length: 14 }, async (_unused, i) => {
        await db.insert(db.tables.snapshots, {
          id: `extra-${i}`,
          projectId: "p1",
          buildId: "b1",
          storyId: `extra-${i}`,
          storyName: "x",
          storyTitle: `Extra${i}`,
          storyImportPath: `./src/Extra${i}.stories.tsx`,
          designUrl: `https://www.figma.com/design/FILE${i}/Kit`,
          screenshotPath: `p1/extra-${i}.png`,
          status: "unchanged",
          createdAt: NOW,
          updatedAt: NOW,
        } as never);
      }),
    );
    let inFlight = 0;
    let peak = 0;
    const calls: string[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith("https://api.figma.com/")) return await real(input, init);
      calls.push(url);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      inFlight -= 1;
      return Response.json({ name: "Kit", version: "1", lastModified: "2025-12-01T00:00:00Z" });
    });
    expect((await app.request("/projects/app/library")).status).toBe(200);
    expect(calls.length).toBeLessThanOrEqual(10);
    expect(calls.length).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("keeps the library up when design data cannot be loaded", async () => {
    const { app } = await seed();
    vi.spyOn(DesignModel.prototype, "componentLinks").mockRejectedValue(new Error("db down"));
    const res = await app.request("/projects/app/library");
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(">Figma<");
  });
});

async function bare() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "App",
    slug: "app",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  await db.insert(db.tables.builds, {
    id: "b1",
    projectId: "p1",
    gitSha: "abc1234",
    gitBranch: "main",
    isDefault: true,
    status: "approved",
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  await db.insert(db.tables.snapshots, {
    id: "s1",
    projectId: "p1",
    buildId: "b1",
    storyId: "button--primary",
    storyName: "Primary",
    storyTitle: "Button",
    storyImportPath: "./src/Button.stories.tsx",
    designUrl: BUTTON_FIGMA,
    screenshotPath: "p1/s1.png",
    status: "changed",
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    config: { secret: SECRET },
  });
  return { app, design: new DesignModel(db, []) };
}

describe("without a design provider", () => {
  it("shows an empty Design tab and no design actions anywhere", async () => {
    const { app } = await bare();
    const settings = await (await app.request("/projects/app/settings/design")).text();
    expect(settings).toContain("No design provider configured");
    expect(settings).not.toContain("Component mapping");
    const library = await (await app.request("/projects/app/library")).text();
    expect(library).not.toContain(">Figma<");
    const review = await (await app.request("/projects/app/builds/b1/diff?snapshot=s1")).text();
    expect(review).not.toContain("Open in");
    const card = await (await app.request("/projects/app/builds/b1")).text();
    expect(card).not.toContain(">Figma<");
  });

  it("refuses to store design links or credentials", async () => {
    const { app, design } = await bare();
    const link = await app.request(
      "/projects/app/settings/design/components",
      post({ importPath: "a.tsx", url: BUTTON_FIGMA }),
    );
    expect(link.status).toBe(400);
    const token = await app.request(
      "/projects/app/settings/design/figma/token",
      post({ token: "x" }),
    );
    expect(token.status).toBe(404);
    expect(await design.componentLinks("p1")).toEqual([]);
  });
});
