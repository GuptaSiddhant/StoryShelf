import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { guardedFetch } from "./outbound-fetch.ts";
import {
  assertOutboundUrl,
  checkOutboundUrl,
  configureOutbound,
  isBlockedAddress,
  OutboundRefusedError,
  outboundReasonText,
  type OutboundResolver,
} from "./outbound.ts";

const publicResolver: OutboundResolver = async () => [{ address: "93.184.216.34", family: 4 }];
const at =
  (...addresses: string[]): OutboundResolver =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

const init = (): { method: string; headers: Record<string, string>; signal: AbortSignal } => ({
  method: "GET",
  headers: {},
  signal: AbortSignal.timeout(5000),
});

afterEach(() => {
  configureOutbound();
});

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.5.4",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "64:ff9b::a00:1",
    "garbage",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe("assertOutboundUrl", () => {
  it("accepts a public https host", async () => {
    await expect(assertOutboundUrl("https://example.com/hook", publicResolver)).resolves.toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);
  });

  it.each([
    "https://127.0.0.1/x",
    "https://10.0.0.1/x",
    "https://169.254.169.254/latest",
    "https://[::1]/x",
  ])("refuses the literal %s", async (url) => {
    await expect(assertOutboundUrl(url, publicResolver)).rejects.toMatchObject({
      reason: "address-not-public",
    });
  });

  it("refuses a name when any resolved address is private", async () => {
    await expect(
      assertOutboundUrl("https://evil.example/x", at("93.184.216.34", "10.0.0.1")),
    ).rejects.toMatchObject({ reason: "address-not-public" });
  });

  it("refuses http, userinfo, bad URLs and unresolvable hosts", async () => {
    expect(await checkOutboundUrl("http://example.com/x", publicResolver)).toBe("scheme-not-https");
    expect(await checkOutboundUrl("https://u:p@example.com/x", publicResolver)).toBe(
      "credentials-in-url",
    );
    expect(await checkOutboundUrl("nope", publicResolver)).toBe("invalid-url");
    expect(await checkOutboundUrl("https://x.example/", at())).toBe("unresolvable");
    expect(
      await checkOutboundUrl("https://x.example/", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).toBe("unresolvable");
  });

  it("never puts the address or URL in the message", async () => {
    const error = await assertOutboundUrl("https://10.1.2.3/secret-path", publicResolver).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(OutboundRefusedError);
    expect((error as Error).message).not.toContain("10.1.2.3");
    expect((error as Error).message).not.toContain("secret-path");
    expect(outboundReasonText("address-not-public")).not.toMatch(/\d+\.\d+/u);
    expect(outboundReasonText("address-not-public")).toContain("outbound.allowHosts");
  });

  it("lets an allowlisted exact host reach a private address, over http", async () => {
    configureOutbound({ allowHosts: ["GitLab.Internal.Example"] });
    await expect(
      assertOutboundUrl("http://gitlab.internal.example/api", at("10.0.0.5")),
    ).resolves.toHaveLength(1);
    expect(await checkOutboundUrl("https://other.internal.example/", at("10.0.0.5"))).toBe(
      "address-not-public",
    );
  });

  it("allows http for public hosts only with allowHttp", async () => {
    configureOutbound({ allowHttp: true });
    expect(await checkOutboundUrl("http://example.com/x", publicResolver)).toBeNull();
    expect(await checkOutboundUrl("http://127.0.0.1/x", publicResolver)).toBe("address-not-public");
  });
});

describe("guardedFetch", () => {
  const servers: http.Server[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.close();
    }
  });

  async function listen(handler: http.RequestListener): Promise<number> {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return (server.address() as AddressInfo).port;
  }

  it("connects to the checked address and ignores later DNS", async () => {
    const port = await listen((_req, res) => res.end("ok"));
    configureOutbound({ allowHosts: ["hook.example"], allowHttp: true });
    const response = await guardedFetch(`http://hook.example:${port}/`, init(), at("127.0.0.1"));
    expect(await response.text()).toBe("ok");
  });

  it("refuses a redirect to a private address", async () => {
    const port = await listen((_req, res) => {
      res.writeHead(302, { location: "http://169.254.169.254/latest" });
      res.end();
    });
    configureOutbound({ allowHosts: ["hook.example"], allowHttp: true });
    await expect(
      guardedFetch(`http://hook.example:${port}/`, init(), (host) =>
        host === "hook.example" ? at("127.0.0.1")(host) : at("169.254.169.254")(host),
      ),
    ).rejects.toMatchObject({ reason: "address-not-public" });
  });

  it("bounds redirect hops", async () => {
    const port = await listen((_req, res) => {
      res.writeHead(302, { location: "/again" });
      res.end();
    });
    configureOutbound({ allowHosts: ["hook.example"], allowHttp: true });
    await expect(
      guardedFetch(`http://hook.example:${port}/`, init(), at("127.0.0.1")),
    ).rejects.toMatchObject({ reason: "too-many-redirects" });
  });
});
