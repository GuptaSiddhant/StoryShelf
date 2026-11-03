import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { UnstableBadge, UnstableNotice, isUnstable } from "./build-diff-unstable.tsx";

async function html(node: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html(node as never));
  return await (await app.request("/")).text();
}

describe("unstable render flag", () => {
  it("is set only when the second render differed", () => {
    expect(isUnstable({ unstable: true })).toBe(true);
    expect(isUnstable({ unstable: false })).toBe(false);
    expect(isUnstable({ unstable: null })).toBe(false);
    expect(isUnstable({})).toBe(false);
  });

  it("shows the badge and the advice for a flagged snapshot", async () => {
    const badge = await html(<UnstableBadge snapshot={{ unstable: true }} />);
    expect(badge).toContain("Unstable render: likely flaky");
    const notice = await html(<UnstableNotice snapshot={{ unstable: true }} />);
    expect(notice).toContain("This change may be noise");
    expect(notice).toContain("data-storyshelf-ignore");
    expect(notice).toContain("flakyTest");
    expect(notice).toContain("still needs review");
  });

  it("shows nothing for a stable, unchecked or unflagged snapshot", async () => {
    const values = [false, null, undefined];
    const pages = await Promise.all(
      values.flatMap((unstable) => [
        html(<UnstableBadge snapshot={{ unstable }} />),
        html(<UnstableNotice snapshot={{ unstable }} />),
      ]),
    );
    expect(pages).toEqual(values.flatMap(() => ["", ""]));
  });
});
