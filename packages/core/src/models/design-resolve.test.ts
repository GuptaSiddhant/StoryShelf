import { describe, expect, it } from "vitest";
import { normalizeImportPath, resolveDesigns } from "./design-resolve.ts";

const A = "https://www.figma.com/design/AAA/Kit?node-id=1-2";
const B = "https://www.figma.com/design/BBB/Other";

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
