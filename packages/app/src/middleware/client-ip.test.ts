import type { TrustProxy } from "@storyshelf/core/config";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createClientIpResolver, normalizeAddress } from "./client-ip.ts";
import { createRateLimiter, rateLimitKey } from "./rate-limit.ts";

const ALB = "10.0.3.7";

/** A request from socket peer `peer` (none when undefined) with `headers`. */
const OFF = undefined;
const NO_SOCKET = undefined;

async function resolveFor(
  trust: TrustProxy | undefined,
  peer: string | undefined,
  headers: Record<string, string> = {},
): Promise<string> {
  const resolve = createClientIpResolver(trust);
  const app = new Hono();
  app.get("/", (c) => c.json(resolve(c) ?? null));
  const env = peer === undefined ? {} : { incoming: { socket: { remoteAddress: peer } } };
  const res = await app.request("/", { headers }, env);
  return res.text();
}

/** An app limited to `max` requests a minute, keyed by `trust`'s resolver. */
function limitedApp(trust: TrustProxy | undefined, max = 1): Hono {
  const clientIp = createClientIpResolver(trust);
  const app = new Hono();
  app.use("*", createRateLimiter(clientIp)({ windowMs: 60_000, max }));
  app.get("/", (c) => c.text(rateLimitKey("api", clientIp)(c)));
  return app;
}

async function fromPeer(
  app: Hono,
  peer: string,
  headers: Record<string, string>,
): Promise<Response> {
  return await app.request("/", { headers }, { incoming: { socket: { remoteAddress: peer } } });
}

describe("createClientIpResolver without trustProxy", () => {
  it("keeps the socket peer and ignores forwarded headers", async () => {
    const body = await resolveFor(OFF, ALB, { "x-forwarded-for": "203.0.113.9" });
    expect(JSON.parse(body)).toEqual({ ip: ALB, source: "peer" });
  });

  it("keeps the unverified header fallback when there is no socket", async () => {
    const xff = await resolveFor(OFF, NO_SOCKET, { "x-forwarded-for": " 1.2.3.4 , 5.6.7.8" });
    expect(JSON.parse(xff)).toEqual({ ip: "1.2.3.4", source: "unverified" });
    const real = await resolveFor(OFF, NO_SOCKET, { "x-real-ip": "9.9.9.9" });
    expect(JSON.parse(real)).toEqual({ ip: "9.9.9.9", source: "unverified" });
    expect(await resolveFor(OFF, NO_SOCKET)).toBe("null");
  });

  it("keeps a peer address that is not an IP as it is", async () => {
    const body = await resolveFor(OFF, "unix-socket");
    expect(JSON.parse(body)).toEqual({ ip: "unix-socket", source: "peer" });
  });
});

describe("createClientIpResolver with a hop count", () => {
  it("takes the client the trusted proxy appended, not a spoofed left entry", async () => {
    const body = await resolveFor(1, ALB, { "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    expect(JSON.parse(body)).toEqual({ ip: "203.0.113.9", source: "proxy" });
  });

  it("counts two hops from the right", async () => {
    const body = await resolveFor(2, ALB, {
      "x-forwarded-for": "6.6.6.6, 198.51.100.4, 10.0.0.2",
    });
    expect(JSON.parse(body)).toEqual({ ip: "198.51.100.4", source: "proxy" });
  });

  it("keeps the peer without a forwarded header", async () => {
    expect(JSON.parse(await resolveFor(1, ALB))).toEqual({ ip: ALB, source: "peer" });
  });

  it("never names a client from an entry that is not an IP", async () => {
    const body = await resolveFor(1, ALB, { "x-forwarded-for": "not-an-ip" });
    expect(JSON.parse(body)).toEqual({ ip: ALB, source: "peer" });
  });

  it("strips ports and IPv4-mapped prefixes", async () => {
    const body = await resolveFor(1, "::ffff:10.0.3.7", { "x-forwarded-for": "203.0.113.9:4711" });
    expect(JSON.parse(body)).toEqual({ ip: "203.0.113.9", source: "proxy" });
  });

  it("reads the header when the runtime exposes no socket", async () => {
    const body = await resolveFor(1, NO_SOCKET, { "x-forwarded-for": "203.0.113.9" });
    expect(JSON.parse(body)).toEqual({ ip: "203.0.113.9", source: "proxy" });
    expect(await resolveFor(1, NO_SOCKET)).toBe("null");
  });
});

describe("createClientIpResolver with a CIDR list", () => {
  const trust = ["10.0.0.0/16", "2001:db8::/32", "192.0.2.1"];

  it("reads the header from a trusted peer and skips trusted hops", async () => {
    const body = await resolveFor(trust, ALB, {
      "x-forwarded-for": "6.6.6.6, 203.0.113.9, 192.0.2.1",
    });
    expect(JSON.parse(body)).toEqual({ ip: "203.0.113.9", source: "proxy" });
  });

  it("trusts IPv6 subnets", async () => {
    const body = await resolveFor(trust, "2001:db8::5", { "x-forwarded-for": "203.0.113.9" });
    expect(JSON.parse(body)).toEqual({ ip: "203.0.113.9", source: "proxy" });
  });

  it("ignores a spoofed header from an untrusted peer", async () => {
    const body = await resolveFor(trust, "198.51.100.77", { "x-forwarded-for": "203.0.113.9" });
    expect(JSON.parse(body)).toEqual({ ip: "198.51.100.77", source: "peer" });
  });

  it("names no client without a socket", async () => {
    expect(await resolveFor(trust, NO_SOCKET, { "x-forwarded-for": "203.0.113.9" })).toBe("null");
  });

  it("refuses an entry that is not an IP or CIDR", () => {
    expect(() => createClientIpResolver(["10.0.0.0/33"])).toThrow(/Invalid trustProxy entry/u);
    expect(() => createClientIpResolver(["proxy.internal"])).toThrow(/Invalid trustProxy/u);
  });
});

describe("createClientIpResolver on Fly", () => {
  it("reads Fly-Client-IP and ignores X-Forwarded-For", async () => {
    const body = await resolveFor("fly", "172.16.5.2", {
      "fly-client-ip": "203.0.113.9",
      "x-forwarded-for": "6.6.6.6",
    });
    expect(JSON.parse(body)).toEqual({ ip: "203.0.113.9", source: "proxy" });
  });

  it("keeps the peer without the header", async () => {
    const body = await resolveFor("fly", "172.16.5.2", { "x-forwarded-for": "6.6.6.6" });
    expect(JSON.parse(body)).toEqual({ ip: "172.16.5.2", source: "peer" });
    expect(await resolveFor("fly", NO_SOCKET)).toBe("null");
  });
});

describe("rate limits behind a proxy", () => {
  it("gives two clients behind a trusted proxy separate buckets", async () => {
    const app = limitedApp(1);
    const first = await fromPeer(app, ALB, { "x-forwarded-for": "203.0.113.1" });
    const second = await fromPeer(app, ALB, { "x-forwarded-for": "203.0.113.2" });
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await second.text()).toBe("api:203.0.113.2");
    const again = await fromPeer(app, ALB, { "x-forwarded-for": "203.0.113.1" });
    expect(again.status).toBe(429);
  });

  it("cannot dodge a limit with a spoofed header from an untrusted peer", async () => {
    const app = limitedApp(["10.0.0.0/16"]);
    const first = await fromPeer(app, "198.51.100.77", { "x-forwarded-for": "203.0.113.1" });
    const second = await fromPeer(app, "198.51.100.77", { "x-forwarded-for": "203.0.113.2" });
    expect([first.status, second.status]).toEqual([200, 429]);
  });

  it("shares the proxy's bucket with the setting off, as before", async () => {
    const app = limitedApp(OFF);
    const first = await fromPeer(app, ALB, { "x-forwarded-for": "203.0.113.1" });
    const second = await fromPeer(app, ALB, { "x-forwarded-for": "203.0.113.2" });
    expect([first.status, second.status]).toEqual([200, 429]);
    expect(await first.text()).toBe(`api:${ALB}`);
  });

  it("keys the unverified fallback and anonymous callers as before", async () => {
    const app = limitedApp(OFF, 5);
    const forwarded = await app.request("/", { headers: { "x-forwarded-for": "1.2.3.4" } });
    expect(await forwarded.text()).toBe("api:fwd:1.2.3.4");
    expect(await (await app.request("/")).text()).toBe("api:anonymous");
  });
});

describe("normalizeAddress", () => {
  it("accepts bare, ported and bracketed addresses", () => {
    expect(normalizeAddress(" 203.0.113.9 ")).toBe("203.0.113.9");
    expect(normalizeAddress("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normalizeAddress("::FFFF:192.0.2.1")).toBe("192.0.2.1");
    expect(normalizeAddress("unknown")).toBeUndefined();
  });
});
