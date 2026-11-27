import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { GitChannelView } from "./admin-git-channels.tsx";
import { MoveChannelBody } from "./git-channel-dialogs.tsx";

vi.mock("../shell/csrf-field.tsx", () => ({ csrfField: () => null }));

const channel: GitChannelView = {
  id: "01JCHANNELTOKEN00000000000",
  kind: "github-token",
  kindLabel: "GitHub token",
  repository: "acme/web",
  host: "api.github.com",
  prefix: "",
  enabled: true,
  updatedAt: "2026-11-20T10:00:00.000Z",
  project: { name: "Web", href: "/projects/web/settings/notifications" },
  connections: [{ id: "01JCONNGITHUB0000000000000", name: "Acme StoryShelf" }],
  canCreate: false,
};

async function render(disabled: boolean): Promise<string> {
  const app = new Hono();
  app.get("/", (c) =>
    c.html(<MoveChannelBody channel={{ ...channel, enabled: !disabled }} target="body" />),
  );
  return await (await app.request("/")).text();
}

const NOTICE = "Once moved, the repository link posts statuses for this project.";

describe("MoveChannelBody", () => {
  it("says the link will post when the channel is disabled", async () => {
    const html = await render(true);
    expect(html).toContain("This channel is disabled.");
    expect(html).toContain(NOTICE);
  });

  it("says nothing extra for an enabled channel", async () => {
    const html = await render(false);
    expect(html).not.toContain(NOTICE);
  });
});
