import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { InvalidDesignUrlError } from "../utils/figma-url.ts";
import { DesignModel, normalizeImportPath, resolveDesigns } from "./design.ts";

const SECRET = "test-secret-00000000";
const A = "https://www.figma.com/design/AAA/Kit?node-id=1-2";
const B = "https://www.figma.com/design/BBB/Other";

function setup(): DesignModel {
  const { db } = makeDatabase();
  return new DesignModel(db, undefined, SECRET);
}

describe("resolveDesigns", () => {
  const snaps = [
    { storyImportPath: "./src/Button.stories.tsx", designUrl: A },
    { storyImportPath: "./src/Button.stories.tsx", designUrl: A },
    { storyImportPath: "./src/Card.stories.tsx", designUrl: null },
    { storyImportPath: null, designUrl: A },
    { storyImportPath: "", designUrl: A },
  ];

  it("dedupes states of a file and drops files without a link", () => {
    const out = resolveDesigns([], snaps);
    expect([...out.keys()]).toEqual(["src/Button.stories.tsx"]);
    expect(out.get("src/Button.stories.tsx")).toEqual({ urls: [A], source: "story" });
  });

  it("shows the distinct set when states of a file disagree", () => {
    const out = resolveDesigns(
      [],
      [
        { storyImportPath: "a.tsx", designUrl: A },
        { storyImportPath: "a.tsx", designUrl: B },
      ],
    );
    expect(out.get("a.tsx")?.urls).toEqual([A, B]);
  });

  it("lets a manual mapping win and add links for files without one", () => {
    const out = resolveDesigns(
      [
        { importPath: "src/Button.stories.tsx", url: B },
        { importPath: "./src/Card.stories.tsx", url: A },
        { importPath: null, url: A },
      ],
      snaps,
    );
    expect(out.get("src/Button.stories.tsx")).toEqual({ urls: [B], source: "manual" });
    expect(out.get("src/Card.stories.tsx")).toEqual({ urls: [A], source: "manual" });
    expect(out.size).toBe(2);
  });

  it("normalizes leading ./", () => {
    expect(normalizeImportPath("./././a/b.tsx")).toBe("a/b.tsx");
  });
});

describe("DesignModel links", () => {
  it("adds project links and rejects non-Figma urls", async () => {
    const model = setup();
    await model.addProjectLink("p1", { label: " Kit ", url: A });
    await expect(
      model.addProjectLink("p1", { label: "x", url: "https://x.com" }),
    ).rejects.toBeInstanceOf(InvalidDesignUrlError);
    const links = await model.projectLinks("p1");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ label: "Kit", importPath: null });
    await expect(model.projectLinks("p2")).resolves.toEqual([]);
  });

  it("upserts component mappings by normalized path", async () => {
    const model = setup();
    await model.setComponentLink("p1", "./src/A.stories.tsx", A);
    await model.setComponentLink("p1", "src/A.stories.tsx", B);
    const links = await model.componentLinks("p1");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ importPath: "src/A.stories.tsx", url: B });
    await expect(model.projectLinks("p1")).resolves.toEqual([]);
  });

  it("removes links scoped to the project", async () => {
    const model = setup();
    await model.setComponentLink("p1", "a.tsx", A);
    const [link] = await model.componentLinks("p1");
    await model.removeLink("p2", link?.id ?? "");
    expect(await model.componentLinks("p1")).toHaveLength(1);
    await model.removeLink("p1", link?.id ?? "");
    expect(await model.componentLinks("p1")).toHaveLength(0);
  });
});

describe("DesignModel token", () => {
  it("encrypts, rotates, tracks health and removes", async () => {
    const model = setup();
    expect(await model.tokenInfo("p1")).toBeNull();
    expect(await model.getToken("p1")).toBeNull();
    await model.recordTokenStatus("p1", "ok");
    await model.setToken("p1", "figd_one");
    const first = await model.tokenInfo("p1");
    expect(first?.tokenEncrypted).not.toContain("figd_one");
    expect(await model.getToken("p1")).toBe("figd_one");
    await model.recordTokenStatus("p1", "unauthorized");
    expect(await model.tokenInfo("p1")).toMatchObject({ status: "unauthorized" });
    await model.setToken("p1", "figd_two");
    expect(await model.getToken("p1")).toBe("figd_two");
    expect(await model.tokenInfo("p1")).toMatchObject({ id: first?.id, status: "unknown" });
    await model.removeToken("p1");
    expect(await model.tokenInfo("p1")).toBeNull();
    await model.removeToken("p1");
  });
});
