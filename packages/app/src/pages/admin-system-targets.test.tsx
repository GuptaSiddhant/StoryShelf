import type { RunnerTarget } from "@storyshelf/core/adapter/capture-runner";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CaptureTargetsCard, REMOTE_BROWSERS_GUIDE } from "./admin-system-targets.tsx";

async function html(node: unknown): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => c.html((node ?? "") as never));
  return await (await app.request("/")).text();
}

const targets: RunnerTarget[] = [
  { target: "chromium", reach: "loopback", status: "ready" },
  { target: "chromium@sprite", reach: "url", status: "ready" },
];

describe("CaptureTargetsCard reachability", () => {
  it("shows nothing extra while every target is reachable", async () => {
    const text = await html(CaptureTargetsCard({ targets, unreachable: new Map() }));
    expect(text).not.toContain("unreachable");
    expect(text).not.toContain(REMOTE_BROWSERS_GUIDE);
  });

  it("marks only the unreachable target, with when and a link to the guide, and no connection detail", async () => {
    const text = await html(
      CaptureTargetsCard({
        targets,
        unreachable: new Map([
          ["chromium@sprite", { reason: "connection", since: "2026-11-20T15:55:00.000Z" }],
        ]),
      }),
    );
    expect(text.match(/unreachable/gu)).toHaveLength(1);
    expect(text).toContain("did not accept a connection");
    expect(text).toContain("2026");
    expect(text).toContain(`href="${REMOTE_BROWSERS_GUIDE}"`);
    expect(text).not.toMatch(/wss?:\/\//u);
  });

  it("lists an outage on a target the runner never offered, after the offered ones", async () => {
    const text = await html(
      CaptureTargetsCard({
        targets: [],
        unreachable: new Map([
          ["firefox", { reason: "launch", since: "2026-11-20T15:55:00.000Z" }],
        ]),
      }),
    );
    expect(text).toContain("firefox");
    expect(text).toContain("unreachable");
    expect(text).not.toContain(">default<");
    const both = await html(
      CaptureTargetsCard({
        targets,
        unreachable: new Map([
          ["firefox", { reason: "launch", since: "2026-11-20T15:55:00.000Z" }],
        ]),
      }),
    );
    expect(both.indexOf("chromium@sprite")).toBeLessThan(both.indexOf("firefox"));
    expect(both.match(/>default</gu)).toHaveLength(1);
  });
});
