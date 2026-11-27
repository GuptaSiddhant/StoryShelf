import type { Auth } from "@storyshelf/core/auth";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createRateLimiter, isHealthRead, rateLimitKey, signedInImageRead } from "./rate-limit.ts";

const IMAGE = "/api/v1/projects/p/builds/b/snapshots/s/image";

/** An auth adapter that knows one session cookie. */
const auth = {
  check: async (req: Request) => (req.headers.get("cookie") === "session=ok" ? { id: "u1" } : null),
} as unknown as Auth;

/** The three limiters index.tsx mounts for this: shared (2), signed-in images (5), health skipped. */
function app(): Hono {
  const rateLimit = createRateLimiter();
  const signedIn = signedInImageRead(auth);
  const hono = new Hono();
  hono.use(
    "/api/v1/*",
    rateLimit({
      windowMs: 60_000,
      max: 2,
      skip: async (c) => isHealthRead(c) || (await signedIn(c)),
    }),
  );
  hono.use(
    "/api/v1/projects/:slug/builds/:buildId/snapshots/:snapshotId/image",
    rateLimit({
      windowMs: 60_000,
      max: 5,
      keyGenerator: rateLimitKey("snapshot-images"),
      skip: async (c) => !(await signedIn(c)),
    }),
  );
  hono.all("*", (c) => c.text("ok"));
  return hono;
}

const status = async (hono: Hono, path: string, cookie?: string): Promise<number> =>
  (await hono.request(path, { headers: cookie ? { cookie } : {} })).status;

describe("rate limits", () => {
  it("never counts health in the shared bucket", async () => {
    const hono = app();
    const answers = await Promise.all(
      Array.from({ length: 10 }, async () => await status(hono, "/api/v1/health")),
    );
    expect(new Set(answers)).toEqual(new Set([200]));
    expect(await status(hono, "/api/v1/projects")).toBe(200);
  });

  it("gives signed-in image reads their own bucket", async () => {
    const hono = app();
    const answers = await Promise.all(
      Array.from({ length: 5 }, async () => await status(hono, IMAGE, "session=ok")),
    );
    expect(new Set(answers)).toEqual(new Set([200]));
    expect(await status(hono, IMAGE, "session=ok")).toBe(429);
    // The shared bucket is untouched by the images.
    expect(await status(hono, "/api/v1/projects")).toBe(200);
  });

  it("keeps the shared floor for anonymous image reads", async () => {
    const hono = app();
    expect(await status(hono, IMAGE)).toBe(200);
    expect(await status(hono, IMAGE, "session=forged")).toBe(200);
    expect(await status(hono, IMAGE)).toBe(429);
  });

  it("sends Retry-After with a 429", async () => {
    const hono = app();
    await status(hono, "/api/v1/projects");
    await status(hono, "/api/v1/projects");
    const res = await hono.request("/api/v1/projects");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("counts only GET image reads as image reads", async () => {
    const res = await app().request(IMAGE, { method: "POST", headers: { cookie: "session=ok" } });
    expect(res.status).toBe(200);
    expect(await signedInImageRead()({ req: { method: "GET", path: IMAGE } } as never)).toBe(false);
  });
});
