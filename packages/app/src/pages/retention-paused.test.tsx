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
    expect(html).toContain("which is being deleted");
    expect(html).toContain("restart");
    // The title is not repeated in the body, and the body leads with the cause.
    expect(html.match(/Retention is paused/gu)).toHaveLength(1);
    expect(html).toContain("cannot tell which builds are safe to purge");
  });

  it("explains a source that belongs to another project", async () => {
    const html = await render({ baselineId: "B1", buildId: "S1", problem: "other-project" });
    expect(html).toContain("which belongs to another project");
  });
});
