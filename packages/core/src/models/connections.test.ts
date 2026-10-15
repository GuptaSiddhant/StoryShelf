import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { makeFakeOAuth } from "../test-helpers/fake-oauth.ts";
import { ConnectionModel } from "./connections.ts";

const SECRET = "test-secret-00000000";
const IN_AN_HOUR = new Date(Date.now() + 3_600_000).toISOString();
const IN_TEN_SECONDS = new Date(Date.now() + 10_000).toISOString();

function setup(): ConnectionModel {
  return new ConnectionModel(makeDatabase().db, SECRET);
}

describe("ConnectionModel", () => {
  it("stores tokens encrypted, replaces them on reconnect and removes them", async () => {
    const model = setup();
    expect(await model.info("u1", "fake")).toBeNull();
    expect(await model.accessToken("u1", "fake")).toBeNull();
    await model.connect("u1", "fake", {
      accessToken: "at-1",
      refreshToken: "rt-1",
      expiresAt: IN_AN_HOUR,
    });
    const first = await model.info("u1", "fake");
    expect(first?.tokenEncrypted).not.toContain("at-1");
    expect(first?.refreshTokenEncrypted).not.toContain("rt-1");
    expect(await model.accessToken("u1", "fake")).toBe("at-1");
    await model.connect("u1", "fake", { accessToken: "at-2", expiresAt: null });
    expect(await model.info("u1", "fake")).toMatchObject({
      id: first?.id,
      refreshTokenEncrypted: null,
    });
    expect(await model.accessToken("u1", "fake")).toBe("at-2");
    await model.remove("u1", "fake");
    expect(await model.info("u1", "fake")).toBeNull();
    await model.remove("u1", "fake");
  });

  it("keeps connections separate per user and service", async () => {
    const model = setup();
    await model.connect("u1", "fake", { accessToken: "ada-fake", expiresAt: null });
    await model.connect("u1", "other", { accessToken: "ada-other", expiresAt: null });
    await model.connect("u2", "fake", { accessToken: "bob-fake", expiresAt: null });
    expect(await model.accessToken("u1", "fake")).toBe("ada-fake");
    expect(await model.accessToken("u1", "other")).toBe("ada-other");
    expect(await model.accessToken("u2", "fake")).toBe("bob-fake");
    const services = (await model.listForUser("u1")).map((row) => row.service);
    expect(services).toHaveLength(2);
    expect(services).toEqual(expect.arrayContaining(["fake", "other"]));
  });
});

describe("ConnectionModel refresh", () => {
  it("does not refresh a token that is not near expiry", async () => {
    const model = setup();
    const oauth = makeFakeOAuth();
    await model.connect("u1", "fake", {
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: IN_AN_HOUR,
    });
    expect(await model.accessToken("u1", "fake", oauth.client)).toBe("at");
    expect(oauth.refreshed).toEqual([]);
  });

  it("refreshes an expiring token once, even for concurrent callers, keeping the old refresh token", async () => {
    const model = setup();
    const oauth = makeFakeOAuth();
    await model.connect("u1", "fake", {
      accessToken: "old",
      refreshToken: "rt",
      expiresAt: IN_TEN_SECONDS,
    });
    const tokens = await Promise.all([
      model.accessToken("u1", "fake", oauth.client),
      model.accessToken("u1", "fake", oauth.client),
      model.accessToken("u1", "fake", oauth.client),
    ]);
    expect(new Set(tokens)).toEqual(new Set(["access-1"]));
    expect(oauth.refreshed).toEqual(["rt"]);
    expect(await model.accessToken("u1", "fake", oauth.client)).toBe("access-1");
    expect(oauth.refreshed).toHaveLength(1);
    expect(await model.info("u1", "fake")).toMatchObject({ status: "ok" });
  });

  it("marks the connection expired when the refresh fails, until the user reconnects", async () => {
    const model = setup();
    const oauth = makeFakeOAuth();
    oauth.failRefresh = true;
    await model.connect("u1", "fake", {
      accessToken: "old",
      refreshToken: "rt",
      expiresAt: IN_TEN_SECONDS,
    });
    expect(await model.accessToken("u1", "fake", oauth.client)).toBeNull();
    expect(await model.info("u1", "fake")).toMatchObject({ status: "expired" });
    oauth.failRefresh = false;
    expect(await model.accessToken("u1", "fake", oauth.client)).toBeNull();
    expect(oauth.refreshed).toHaveLength(1);
    await model.connect("u1", "fake", { accessToken: "new", expiresAt: null });
    expect(await model.accessToken("u1", "fake", oauth.client)).toBe("new");
  });

  it("expires a connection that cannot be refreshed (no refresh token or no client)", async () => {
    const model = setup();
    await model.connect("u1", "fake", { accessToken: "old", expiresAt: IN_TEN_SECONDS });
    expect(await model.accessToken("u1", "fake", makeFakeOAuth().client)).toBeNull();
    await model.connect("u2", "fake", {
      accessToken: "old",
      refreshToken: "rt",
      expiresAt: IN_TEN_SECONDS,
    });
    expect(await model.accessToken("u2", "fake")).toBeNull();
    expect(await model.info("u2", "fake")).toMatchObject({ status: "expired" });
  });
});
