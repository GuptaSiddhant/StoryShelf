import { MemberModel, TokenModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { sha256 } from "@storyshelf/core/utils";
import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

/** Who a comment is attributed to (#1476): the session user, else the bearer token's owner. */

const NOW = "2026-01-01T00:00:00.000Z";
const users = ["dev", "ann"].map((id) => ({
  id,
  email: `${id}@example.com`,
  name: id,
  role: "member" as const,
}));

const auth = stubAuth(null, {
  check: async (request: Request) => {
    const cookie = request.headers.get("cookie") ?? "";
    const id = /storyshelf_session=(?<id>\w+)/u.exec(cookie)?.groups?.["id"];
    return await Promise.resolve(users.find((user) => user.id === id) ?? null);
  },
});

let scratchDir = "";
beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-comments-"));
});
afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

function storybookZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile("iframe.html", Buffer.from("<html></html>"));
  zip.addFile(
    "index.json",
    Buffer.from(
      JSON.stringify({
        v: 5,
        entries: {
          "a--x": { type: "story", id: "a--x", title: "A", name: "X", importPath: "./A.tsx" },
        },
      }),
    ),
  );
  return zip.toBuffer();
}

const session = (id: string): Record<string, string> => ({
  cookie: `storyshelf_session=${id}`,
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
});

async function boot() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Gate",
    slug: "gate",
    gitRepository: "acme/widgets",
    gitDefaultBranch: "main",
    reviewEnabled: true,
    reviewApprovals: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await Promise.all(
    users.map(async (user) => {
      await db.insert(db.tables.users, {
        ...user,
        avatarUrl: null,
        lastLoginAt: null,
        createdAt: NOW,
      });
      await new MemberModel(db).set("p1", user.id, "developer");
    }),
  );
  const app = createShelfApp({
    database: db,
    storage,
    auth,
    config: { secret: "s", scratchDir, publicBaseUrl: "https://shelf.example", adminToken: "root" },
    logger: pino({ level: "silent" }),
  });
  await app.lifecycle.setup();
  const created = await app.request("/api/v1/projects/gate/builds", {
    method: "POST",
    headers: session("dev"),
    body: JSON.stringify({ gitSha: "c".repeat(40), gitBranch: "feature/x" }),
  });
  const { build } = (await created.json()) as { build: { id: string } };
  const upload = await app.request(`/api/v1/projects/gate/builds/${build.id}/zip`, {
    method: "PUT",
    headers: { ...session("dev"), "content-type": "application/zip" },
    body: new Uint8Array(storybookZip()),
  });
  expect(upload.status).toBe(202);
  const comment = async (headers: Record<string, string>, body = "Looks fine"): Promise<Response> =>
    await app.request(`/api/v1/projects/gate/builds/${build.id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ body }),
    });
  return { app, db, comment };
}

describe("comment author", () => {
  it("attributes a token's comment to the user who owns the token", async () => {
    const booted = await boot();
    await new TokenModel(booted.db).create("p1", {
      name: "ann-ci",
      hash: sha256("ann-token"),
      userId: "ann",
    });
    const response = await booted.comment({ authorization: "Bearer ann-token" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ userId: "ann" });
    await booted.app.lifecycle.teardown();
  });

  it("keeps a null author for the admin token", async () => {
    const booted = await boot();
    const response = await booted.comment({ authorization: "Bearer root" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ userId: null });
    await booted.app.lifecycle.teardown();
  });

  it("still refuses a token without an owner, which has no role on the project", async () => {
    const booted = await boot();
    await new TokenModel(booted.db).create("p1", {
      name: "ownerless",
      hash: sha256("ownerless-token"),
      userId: null,
    });
    const response = await booted.comment({ authorization: "Bearer ownerless-token" });
    expect(response.status).toBe(403);
    await booted.app.lifecycle.teardown();
  });

  it("leaves a session comment attributed to the signed-in user", async () => {
    const booted = await boot();
    const response = await booted.comment(session("dev"));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ userId: "dev" });
    await booted.app.lifecycle.teardown();
  });

  it("never notifies a token's owner about a comment mentioning them", async () => {
    const booted = await boot();
    await new TokenModel(booted.db).create("p1", {
      name: "ann-ci",
      hash: sha256("ann-token"),
      userId: "ann",
    });
    const response = await booted.comment({ authorization: "Bearer ann-token" }, "cc @ann");
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      userId: "ann",
      mentions: [{ userId: "ann", handle: expect.any(String) }],
    });
    await booted.app.lifecycle.teardown();
  });
});
