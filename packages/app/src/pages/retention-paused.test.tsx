import type { RetentionPause } from "@storyshelf/core/adapter/database";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { RetentionPausedNotice } from "./retention-paused.tsx";

async function render(pause?: RetentionPause): Promise<string> {
  const app = new Hono().get("/", (c): Response | Promise<Response> =>
    c.html(<RetentionPausedNotice pause={pause} />),
  );
  return await (await app.request("/")).text();
}

describe("RetentionPausedNotice", () => {
  it("renders nothing while retention is on", async () => {
    expect(await render()).toBe("");
  });

  it("names the baseline and the build, and says why", async () => {
    const html = await render({ baselineId: "B1", buildId: "S1", problem: "tombstoned" });
    expect(html).toContain("Retention is paused");
    expect(html).toContain("<code>B1</code>");
    expect(html).toContain("<code>S1</code>");
    expect(html).toContain("is being deleted");
    expect(html).toContain("restart");
  });

  it("explains a source that belongs to another project", async () => {
    const html = await render({ baselineId: "B1", buildId: "S1", problem: "other-project" });
    expect(html).toContain("belongs to another project");
  });
});
