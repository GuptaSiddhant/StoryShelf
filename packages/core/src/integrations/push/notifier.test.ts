import { createECDH } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifierContractSuite } from "../../test-helpers/index.ts";
import { publicNetworkForTests } from "../../test-helpers/public-network.ts";
import { toBase64Url } from "./base64url.ts";
import { vapidConfigFromEnv } from "./config.ts";
import { createPushNotifier } from "./notifier.ts";
import { PushGoneError } from "./send.ts";
import { createVapid } from "./vapid.ts";

function keyPair(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: toBase64Url(ecdh.getPublicKey()),
    privateKey: toBase64Url(ecdh.getPrivateKey()),
  };
}

const vapidConfig = { ...keyPair(), subject: "mailto:ops@example.com" };
const vapid = createVapid(vapidConfig);
const device = keyPair();
const config = {
  endpoint: "https://push.example.net/p/secret-path-token",
  p256dh: device.publicKey,
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
};
const formatted = { subject: "Build failed", text: "Build 7 failed", markdown: "", html: "" };
const channel = {
  id: "c",
  projectId: null,
  provider: "push",
  config,
  events: [],
  enabled: true,
};

notifierContractSuite("push", () => createPushNotifier(vapid));

let restoreNetwork: () => void = () => {};
beforeEach(() => {
  restoreNetwork = publicNetworkForTests();
});
afterEach(() => {
  restoreNetwork();
  vi.unstubAllGlobals();
});

describe("push notifier", () => {
  it("is addressed to a person", () => {
    expect(createPushNotifier(vapid).metadata.audience).toBe("person");
  });

  it("posts an encrypted body with a VAPID header", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 201 })));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createPushNotifier(vapid).create({ config });
    await adapter.send({ channel, formatted });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers.authorization).toMatch(/^vapid t=.+, k=/u);
    expect(init.body).toBeInstanceOf(Uint8Array);
  });

  it("reports a 410 as gone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("gone", { status: 410 }))),
    );
    const adapter = createPushNotifier(vapid).create({ config });
    await expect(adapter.send({ channel, formatted })).rejects.toBeInstanceOf(PushGoneError);
  });

  it("keeps the private key, endpoint and body out of errors and logs", async () => {
    const lines: string[] = [];
    const logger = {
      debug: (...a: unknown[]) => lines.push(JSON.stringify(a)),
      info: (...a: unknown[]) => lines.push(JSON.stringify(a)),
      warn: (...a: unknown[]) => lines.push(JSON.stringify(a)),
      child: () => logger,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(`${vapidConfig.privateKey} ${config.endpoint}`, { status: 400 }),
        ),
      ),
    );
    const adapter = createPushNotifier(vapid).create({ config, logger: logger as never });
    const error = await adapter
      .send({ channel, formatted, logger: logger as never })
      .catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(Error);
    const seen = `${(error as Error).message}${(error as Error).stack ?? ""}${lines.join("")}`;
    expect(seen).not.toContain(vapidConfig.privateKey);
    expect(seen).not.toContain("secret-path-token");
  });

  it("tells onGone about a 410 and ends without an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("gone", { status: 410 }))),
    );
    const gone = vi.fn(() => Promise.resolve());
    const adapter = createPushNotifier(vapid, { onGone: gone }).create({ config });
    await adapter.send({ channel, formatted });
    expect(gone).toHaveBeenCalledWith(config);
  });

  it("still throws for other failures with onGone set", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("busy", { status: 503 }))),
    );
    const gone = vi.fn(() => Promise.resolve());
    const adapter = createPushNotifier(vapid, { onGone: gone }).create({ config });
    await expect(adapter.send({ channel, formatted })).rejects.toThrow("HTTP 503");
    expect(gone).not.toHaveBeenCalled();
  });

  it("sends a one-line body and only a relative link", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 201 })));
    vi.stubGlobal("fetch", fetchMock);
    const spy = vi.spyOn(await import("./encrypt.ts"), "encryptPayload");
    const adapter = createPushNotifier(vapid).create({ config });
    await adapter.send({
      channel,
      formatted: {
        ...formatted,
        summary: "Shelf: build:failed on main",
        url: "https://shelf.example.com/projects/p/builds/b1",
      },
    });
    const sent = spy.mock.calls[0]?.[0];
    expect(JSON.parse(String(sent))).toEqual({
      title: "Build failed",
      body: "Shelf: build:failed on main",
      url: "/projects/p/builds/b1",
    });
    spy.mockRestore();
  });

  it("rejects a config without an endpoint", () => {
    expect(() => createPushNotifier(vapid).create({ config: {} })).toThrow();
  });
});

describe("vapidConfigFromEnv", () => {
  it("is off without both keys", () => {
    expect(vapidConfigFromEnv({})).toBeUndefined();
    expect(vapidConfigFromEnv({ SHELF_VAPID_PUBLIC_KEY: "a" })).toBeUndefined();
  });

  it("requires a subject once both keys are set", () => {
    expect(() =>
      vapidConfigFromEnv({ SHELF_VAPID_PUBLIC_KEY: "a", SHELF_VAPID_PRIVATE_KEY: "b" }),
    ).toThrow("SHELF_VAPID_SUBJECT is required");
  });

  it("reads the keys and subject", () => {
    expect(
      vapidConfigFromEnv({
        SHELF_VAPID_PUBLIC_KEY: "a",
        SHELF_VAPID_PRIVATE_KEY: "b",
        SHELF_VAPID_SUBJECT: "mailto:x@y.z",
      }),
    ).toEqual({ publicKey: "a", privateKey: "b", subject: "mailto:x@y.z" });
  });
});
