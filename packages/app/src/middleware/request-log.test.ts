import { signStorybookToken } from "@storyshelf/core/utils";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { requestLogging } from "./request-log.ts";

describe("requestLogging", () => {
  it("keeps a signed Storybook token out of the logged URL", async () => {
    const info = vi.fn();
    const app = new Hono();
    app.use("*", requestLogging({ info } as never));
    app.get("/s/:token/*", (c) => c.text("ok"));
    const token = signStorybookToken({ secret: "k", projectId: "p1", buildId: "b1" });

    await app.request(`/s/${token}/iframe.html`);

    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain("/s/[redacted]/iframe.html");
    expect(logged).not.toContain(token);
  });
});
