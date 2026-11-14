import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { UnverifiedDefaultNotice } from "./admin-system-branch.tsx";

async function html(node: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html((node ?? "") as never));
  return await (await app.request("/")).text();
}

describe("UnverifiedDefaultNotice", () => {
  it("lists the projects that count default-branch builds unverified, linking their settings", async () => {
    const text = await html(
      UnverifiedDefaultNotice({
        projects: [
          { name: "Web", slug: "web" },
          { name: "Docs", slug: "docs" },
        ],
      }),
    );
    expect(text).toContain("2 projects count");
    expect(text).toContain('href="/projects/web/settings/tests"');
    expect(text).toContain('href="/projects/docs/settings/tests"');
  });

  it("shows nothing when every project verifies its default branch", async () => {
    expect(await html(UnverifiedDefaultNotice({ projects: [] }))).toBe("");
    expect(await html(UnverifiedDefaultNotice({ projects: undefined }))).toBe("");
  });
});
