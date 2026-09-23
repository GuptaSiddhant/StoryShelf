import { createShelfLogger } from "@storyshelf/core/logger";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

function styleBlock(html: string): string {
  const match = /<style>(?<css>[\s\S]*)<\/style>/u.exec(html);
  if (!match?.groups?.["css"]) {
    throw new Error("expected a <style> block in the document");
  }
  return match.groups["css"];
}

describe("DocumentLayout stylesheet", () => {
  it("serves the CSS unescaped so selectors and font stacks survive", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({
      database: db,
      storage,
      logger: createShelfLogger({ level: "silent" }),
    });
    const html = await (await app.request("/")).text();
    const css = styleBlock(html);
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain("font-family:");
    expect(css).not.toContain("&quot;");
    expect(css).not.toContain("&gt;");
    expect(css).not.toContain("&lt;");
    expect(css).not.toContain("&#39;");
  });
});
