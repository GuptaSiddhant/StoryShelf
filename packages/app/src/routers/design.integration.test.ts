import { DesignModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";

const SECRET = "design-test-secret";
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
    config: { secret: SECRET },
  });
  return { db, app, design: new DesignModel(db, undefined, SECRET) };
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
    return url.startsWith("https://api.figma.com/") ? handler(url) : await real(input, init);
  });
}

describe("design settings", () => {
  it("manages design files, component mappings and the write-only token", async () => {
    const { app, design } = await seed();
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

    await app.request("/projects/app/settings/design/token", post({ token: "figd_secret_value" }));
    const withToken = await (await app.request("/projects/app/settings/design")).text();
    expect(withToken).toContain("Not used yet");
    expect(withToken).not.toContain("figd_secret_value");
    expect(await design.getToken("p1")).toBe("figd_secret_value");

    await app.request("/projects/app/settings/design/token/delete", post({}));
    expect(await design.tokenInfo("p1")).toBeNull();

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
    expect(await badFile.text()).toContain("Figma file, design, board or prototype URL");
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
    const noToken = await app.request("/projects/app/settings/design/token", post({ token: "" }));
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
    const { app, design } = await seed();
    await design.setToken("p1", "figd_tok");
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
    expect((await design.tokenInfo("p1"))?.status).toBe("ok");
  });

  it("reports a deleted node without blocking review", async () => {
    const { app, design } = await seed();
    await design.setToken("p1", "figd_tok");
    figmaApi(() => Response.json({ name: "Kit", nodes: { "1:2": null } }));
    const gone = await (
      await app.request("/projects/app/builds/b1/diff?snapshot=button-primary")
    ).text();
    expect(gone).toContain("Design not found");
    expect(gone).toContain("Open in Figma");
  });

  it("reports an expired token without blocking review", async () => {
    const { app, design } = await seed();
    await design.setToken("p1", "figd_tok");
    figmaApi(() => new Response("{}", { status: 401 }));
    const expired = await (
      await app.request("/projects/app/builds/b1/diff?snapshot=button-primary")
    ).text();
    expect(expired).toContain("expired or revoked");
    expect(expired).toContain("Open in Figma");
  });
});
