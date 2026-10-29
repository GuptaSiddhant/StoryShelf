import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { publishedGzipPath, signStorybookToken, storybookDir } from "@storyshelf/core/utils";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

const SECRET = "signed-url-secret-signed-url-secret";
const file = Buffer.from("<html>published preview</html>".repeat(500));
const hash = createHash("sha256").update(file).digest("hex");
const headers = { "accept-encoding": "gzip" };

async function setup(compression?: boolean) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "One",
    slug: "one",
    gitRepository: "owner/repo",
    gitDefaultBranch: "main",
    pixelThreshold: 0.1,
    maxDiffRatio: 0.01,
    publicBranchRegex: null,
    executePlay: false,
    playTimeoutMs: 10_000,
    storybookMeta: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  });
  await db.insert(db.tables.builds, {
    id: "b1",
    projectId: "p1",
    gitSha: "sha",
    gitBranch: "feature",
    isDefault: false,
    public: false,
    status: "approved",
    snapshotCount: 0,
    changedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    inheritedCount: 0,
    affectedOnly: true,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  });
  objects.set(
    `${storybookDir("p1", "b1")}/manifest.json`,
    Buffer.from(JSON.stringify({ "iframe.html": hash })),
  );
  objects.set(`content/${hash}`, file);
  const common = {
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    config: {
      secret: SECRET,
      ...(compression === undefined ? {} : { publishedCompression: compression }),
    },
    testing: { runner: stubRunner() },
  };
  const anonymous = createShelfApp({ ...common, auth: stubAuth(null) });
  const session = createShelfApp({
    ...common,
    auth: stubAuth({ id: "u1", email: "a@example.com", name: "Ada", role: "admin" }),
  });
  const publicApp = createShelfApp(common);
  const token = signStorybookToken({ secret: SECRET, projectId: "p1", buildId: "b1" });
  return { anonymous, session, publicApp, token, objects, storage };
}

describe("published gzip access", () => {
  it("serves original on the first request, then gzip to authorized routes only", async () => {
    const { anonymous, session, publicApp, token, objects, storage } = await setup(true);
    try {
      const route = `/_s/${token}/iframe.html`;
      const first = await anonymous.request(route, { headers });
      expect(first.headers.get("content-encoding")).toBeNull();
      expect(first.headers.get("vary")).toBe("Accept-Encoding");
      expect(first.headers.get("cache-control")).toBe("private, no-store");
      expect(Buffer.from(await first.arrayBuffer())).toEqual(file);
      await vi.waitFor(() => expect(objects.has(publishedGzipPath(hash))).toBe(true));
      const read = vi.spyOn(storage, "read");
      const refused = await anonymous.request("/_s/invalid/iframe.html", { headers });
      expect(refused.status).toBe(404);
      expect(read).not.toHaveBeenCalledWith(publishedGzipPath(hash));
      const privateFile = await anonymous.request("/projects/one/storybook/build/b1/iframe.html", {
        headers,
      });
      expect(privateFile.status).not.toBe(200);
      expect(read).not.toHaveBeenCalledWith(publishedGzipPath(hash));
      const signed = await anonymous.request(route, { headers });
      const authorized = await session.request("/projects/one/storybook/build/b1/iframe.html", {
        headers,
      });
      const publicFile = await publicApp.request("/projects/one/storybook/build/b1/iframe.html", {
        headers,
      });
      for (const response of [signed, authorized, publicFile]) {
        expect(response.status).toBe(200);
        expect(response.headers.get("content-encoding")).toBe("gzip");
        // oxlint-disable-next-line eslint/no-await-in-loop -- verify each response body independently
        expect(gunzipSync(Buffer.from(await response.arrayBuffer()))).toEqual(file);
      }
      expect(signed.headers.get("cache-control")).toBe("private, no-store");
      expect(signed.headers.get("access-control-allow-origin")).toBe("*");
      expect(authorized.headers.get("access-control-allow-origin")).toBeNull();
      expect(publicFile.headers.get("access-control-allow-origin")).toBe("*");
      const refusedGzip = await anonymous.request(route, {
        headers: { "accept-encoding": "gzip;q=0" },
      });
      expect(refusedGzip.headers.get("content-encoding")).toBeNull();
      expect(Buffer.from(await refusedGzip.arrayBuffer())).toEqual(file);
      objects.delete(publishedGzipPath(hash));
      const missing = await anonymous.request(route, { headers });
      expect(missing.headers.get("content-encoding")).toBeNull();
      expect(Buffer.from(await missing.arrayBuffer())).toEqual(file);
    } finally {
      await Promise.all([
        anonymous.lifecycle.teardown(),
        session.lifecycle.teardown(),
        publicApp.lifecycle.teardown(),
      ]);
    }
  });

  it("does not negotiate or generate variants when disabled", async () => {
    const { anonymous, session, publicApp, token, objects } = await setup();
    try {
      const response = await anonymous.request(`/_s/${token}/iframe.html`, { headers });
      expect(response.headers.get("content-encoding")).toBeNull();
      expect(response.headers.get("vary")).toBeNull();
      expect(objects.has(publishedGzipPath(hash))).toBe(false);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(file);
    } finally {
      await Promise.all([
        anonymous.lifecycle.teardown(),
        session.lifecycle.teardown(),
        publicApp.lifecycle.teardown(),
      ]);
    }
  });

  it("serves a legacy file without inventing a content identity", async () => {
    const { anonymous, session, publicApp, token, objects } = await setup(true);
    try {
      const dir = storybookDir("p1", "b1");
      objects.delete(`${dir}/manifest.json`);
      objects.set(`${dir}/iframe.html`, file);
      const response = await anonymous.request(`/_s/${token}/iframe.html`, { headers });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-encoding")).toBeNull();
      expect(Buffer.from(await response.arrayBuffer())).toEqual(file);
      expect(objects.has(publishedGzipPath(hash))).toBe(false);
    } finally {
      await Promise.all([
        anonymous.lifecycle.teardown(),
        session.lifecycle.teardown(),
        publicApp.lifecycle.teardown(),
      ]);
    }
  });

  it("does not block shutdown or surface a delayed generation failure", async () => {
    const { anonymous, session, publicApp, token, storage } = await setup(true);
    const gate = Promise.withResolvers<null>();
    const write = vi.spyOn(storage, "write").mockImplementation(async () => {
      await gate.promise;
    });
    let stopped = false;
    try {
      const response = await anonymous.request(`/_s/${token}/iframe.html`, { headers });
      expect(Buffer.from(await response.arrayBuffer())).toEqual(file);
      await vi.waitFor(() => expect(write).toHaveBeenCalledOnce(), { timeout: 10_000 });
      await Promise.all([
        anonymous.lifecycle.teardown(),
        session.lifecycle.teardown(),
        publicApp.lifecycle.teardown(),
      ]);
      stopped = true;
      gate.reject(new Error("storage stopped"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      gate.resolve(null);
      if (!stopped)
        await Promise.all([
          anonymous.lifecycle.teardown(),
          session.lifecycle.teardown(),
          publicApp.lifecycle.teardown(),
        ]);
    }
  }, 15_000);
});
