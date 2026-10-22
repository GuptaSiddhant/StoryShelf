import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { createPublicOriginResolver, PUBLIC_ORIGIN_KEY } from "./public-origin.ts";
import { SiteSettingsModel } from "./site-settings.ts";

function setup(
  options: { publicBaseUrl?: string; env?: Record<string, string>; ttlMs?: number } = {},
) {
  const { db } = makeDatabase();
  const resolver = createPublicOriginResolver({
    db,
    config: options.publicBaseUrl === undefined ? {} : { publicBaseUrl: options.publicBaseUrl },
    env: options.env ?? {},
    ttlMs: options.ttlMs ?? 0,
  });
  return { db, resolver };
}

describe("createPublicOriginResolver", () => {
  it("resolves nothing when nothing is configured, detected or reported", async () => {
    const { resolver } = setup();
    expect(await resolver.resolve()).toBeNull();
    expect(await resolver.url()).toBeUndefined();
    expect(await resolver.stored()).toBeNull();
  });

  it("prefers the configured URL (path prefix kept) over the platform and the stored origin", async () => {
    const { resolver } = setup({
      publicBaseUrl: "https://shelf.example.com/storyshelf/",
      env: { FLY_APP_NAME: "shelf" },
    });
    await resolver.set("https://admin.example.com");
    expect(await resolver.resolve()).toEqual({
      url: "https://shelf.example.com/storyshelf",
      source: "config",
      confirmed: true,
    });
  });

  it("falls back to the platform address, then to the admin's origin", async () => {
    const platform = setup({ env: { FLY_APP_NAME: "shelf" } });
    await platform.resolver.set("https://admin.example.com");
    expect(await platform.resolver.resolve()).toMatchObject({
      url: "https://shelf.fly.dev",
      source: "platform",
    });
    const admin = setup();
    await admin.resolver.report("https://admin.example.com");
    expect(await admin.resolver.resolve()).toEqual({
      url: "https://admin.example.com",
      source: "admin",
      confirmed: false,
    });
  });

  it("keeps the first report and lets an explicit set replace it", async () => {
    const { resolver } = setup();
    expect(await resolver.report("https://first.example.com")).toEqual({
      origin: "https://first.example.com",
      confirmed: false,
    });
    expect(await resolver.report("https://second.example.com")).toMatchObject({
      origin: "https://first.example.com",
    });
    expect(await resolver.set("https://second.example.com", "user-1")).toEqual({
      origin: "https://second.example.com",
      confirmed: true,
    });
    expect(await resolver.url()).toBe("https://second.example.com");
  });

  it("clears the stored origin", async () => {
    const { resolver } = setup();
    await resolver.set("https://a.example.com");
    await resolver.clear();
    expect(await resolver.resolve()).toBeNull();
  });

  it("rejects anything that is not a bare http(s) origin", async () => {
    const { resolver } = setup();
    const bad = [
      "javascript:alert(1)",
      "https://a.example.com/path",
      "https://a.example.com/?x=1",
      "nonsense url",
      "",
    ];
    await Promise.all(
      bad.flatMap((value) => [
        expect(resolver.set(value), value).rejects.toThrow(/public origin must be/u),
        expect(resolver.report(value), value).rejects.toThrow(/public origin must be/u),
      ]),
    );
  });

  it("reuses a database read for the ttl and sees other instances' writes after it", async () => {
    const { db, resolver } = setup({ ttlMs: 60_000 });
    expect(await resolver.stored()).toBeNull();
    await new SiteSettingsModel(db).set(
      PUBLIC_ORIGIN_KEY,
      JSON.stringify({ origin: "https://other.example.com", confirmed: true }),
    );
    expect(await resolver.stored()).toBeNull();
    const fresh = createPublicOriginResolver({ db, env: {}, ttlMs: 0 });
    expect(await fresh.stored()).toEqual({ origin: "https://other.example.com", confirmed: true });
  });

  it("ignores a stored value it cannot read", async () => {
    const { db, resolver } = setup();
    const settings = new SiteSettingsModel(db);
    await settings.set(PUBLIC_ORIGIN_KEY, "not json");
    expect(await resolver.stored()).toBeNull();
    await settings.set(PUBLIC_ORIGIN_KEY, JSON.stringify({ origin: "ftp://x", confirmed: true }));
    expect(await resolver.stored()).toBeNull();
  });
});
