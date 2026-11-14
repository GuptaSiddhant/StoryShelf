import { describe, expect, it } from "vitest";
import { renderOfflineHome } from "./service-worker-home.ts";

const DAY = 86_400_000;
const project = (ageDays: number): Parameters<typeof renderOfflineHome>[0][string] => ({
  name: "Design <system>",
  commit: "9f3c2a1b7d",
  syncedAt: new Date(Date.now() - ageDays * DAY).toISOString(),
  maxOfflineDays: 30,
});

describe("offline home page", () => {
  it("says you are offline and what to do when nothing is kept", async () => {
    const html = await renderOfflineHome({});
    expect(html).toContain("You are offline");
    expect(html).toContain("No Storybooks are kept on this device");
  });

  it("links a kept project, escapes its name, and carries its inlined theme CSS", async () => {
    const html = await renderOfflineHome({ ds: project(1) });
    expect(html).toContain('href="/offline/ds/"');
    expect(html).toContain("Design &lt;system&gt;");
    expect(html).toContain("<style>");
    expect(html).toContain("prefers-color-scheme:dark");
  });

  it("never embeds scripts or app HTML", async () => {
    const html = await renderOfflineHome({ ds: project(1) });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("hx-");
  });

  it("shows a project past its expiry without a link", async () => {
    const html = await renderOfflineHome({ ds: project(31) });
    expect(html).not.toContain('href="/offline/ds/"');
    expect(html).toContain("Expired. Go online to sync.");
  });
});
