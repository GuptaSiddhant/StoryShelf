import { TargetLaunchError, remoteTargetsOf } from "@storyshelf/core/adapter/capture-runner";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { connectRemote, reasonOf } from "./connect.ts";
import { remote } from "./remote/remote.ts";
import { playwrightVersion } from "./version.ts";

/** A server that answers the WebSocket handshake with `status` and `body`, like a refusing farm. */
async function refusingServer(
  status: string,
  body: string,
): Promise<{ url: string; server: Server }> {
  const server = createServer();
  server.on("upgrade", (_request, socket) => {
    socket.end(`HTTP/1.1 ${status}\r\ncontent-type: text/plain\r\n\r\n${body}`);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/farm?key=sekret-key`,
    server,
  };
}

function targetOf(endpoint: string, retries = 0) {
  const service = remote({
    name: "farm",
    engines: ["chromium"],
    sessions: 1,
    retry: { attempts: retries, backoffMs: 1 },
    timeouts: { connectMs: 3000 },
    protocol: "playwright",
    reach: "url",
    connect: { endpoint, headers: { authorization: "Bearer sekret-token" } },
  });
  return remoteTargetsOf(service)[0] as NonNullable<ReturnType<typeof remoteTargetsOf>[0]>;
}

const CTX = { buildId: "b1", runId: "b1", purpose: "render" } as const;
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      async (server) =>
        await new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
});

async function serve(status: string, body: string): Promise<string> {
  const { url, server } = await refusingServer(status, body);
  servers.push(server);
  return url;
}

describe("connectRemote", () => {
  it("names both versions when the server's differs, and does not retry or leak the endpoint", async () => {
    const box = [
      "Playwright version mismatch:",
      "  - server version: v1.40",
      "  - client version: v1.63",
    ].join("\n");
    const url = await serve("428 Precondition Required", box);
    const warn = vi.fn();
    const error: unknown = await connectRemote(targetOf(url, 3), CTX, { warn } as never).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(TargetLaunchError);
    const launch = error as TargetLaunchError;
    expect(launch.reason).toContain("the server runs v1.40");
    expect(launch.reason).toContain(`playwright-core is ${playwrightVersion()}`);
    expect(launch.transient).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(launch.message + String(launch.cause)).not.toContain("sekret");
  });

  it("refuses credentials once, without leaking them", async () => {
    const url = await serve("401 Unauthorized", "no");
    const error = (await connectRemote(targetOf(url, 3), CTX).catch(
      (caught: unknown) => caught,
    )) as TargetLaunchError;
    expect(error.transient).toBe(false);
    expect(error.reason).toContain("401");
    expect(error.reason).not.toContain("sekret");
    expect(error.reason).not.toContain("127.0.0.1");
  });

  it("retries a service that is not listening, and reports it as one that may come back", async () => {
    const { url, server } = await refusingServer("200 OK", "");
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    const warn = vi.fn();
    const error = (await connectRemote(targetOf(url, 2), CTX, { warn } as never).catch(
      (caught: unknown) => caught,
    )) as TargetLaunchError;
    expect(error).toBeInstanceOf(TargetLaunchError);
    expect(error.transient).toBe(true);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ target: "chromium@farm", retry: 1 });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("sekret");
  });
});

describe("reasonOf", () => {
  const connection = {
    endpoint: "wss://farm.example/tenant-7?key=sekret-key",
    headers: { authorization: "Bearer sekret-token" },
  };

  it("keeps what a WebSocket error event says, never [object Object]", () => {
    const event = { type: "error", error: new Error("connect ECONNREFUSED 10.0.0.9:9222") };
    expect(reasonOf(event, connection)).toBe("connect ECONNREFUSED 10.0.0.9:9222");
    expect(reasonOf({ type: "close", code: 1006, reason: "" }, connection)).toBe(
      "close event (code 1006)",
    );
    expect(reasonOf({}, connection)).toBe("unknown error");
    expect(reasonOf("plain text", connection)).toBe("plain text");
  });

  it("adds the cause of an Error, such as the failure behind `fetch failed`", () => {
    const error = new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
    expect(reasonOf(error, connection)).toBe("fetch failed: connect ECONNREFUSED");
  });

  it("scrubs the endpoint before cutting a long message, so no half of it is left", () => {
    const long = `${"x".repeat(470)} ${connection.endpoint} ${"y".repeat(100)}`;
    const text = reasonOf(new Error(long), connection);
    expect(text.length).toBeLessThanOrEqual(500);
    expect(text).not.toMatch(/farm|sekret|tenant/u);
  });

  it("removes a bare Bearer token that a nested cause quotes without the scheme", () => {
    const error = new Error("connect failed", { cause: { message: "401 for token sekret-token" } });
    const text = reasonOf(error, connection);
    expect(text).not.toContain("sekret-token");
    expect(text).toContain("connect failed");
  });

  it("removes the endpoint, its credentials and header values from any shape", () => {
    const text = reasonOf(
      { message: `cannot reach ${connection.endpoint} with Bearer sekret-token` },
      connection,
    );
    expect(text).not.toContain("sekret");
    expect(text).not.toContain("farm.example");
    expect(
      reasonOf(
        new Error(`handshake to ${connection.endpoint} failed`, {
          cause: { message: "token=abc123 refused" },
        }),
        connection,
      ),
    ).not.toMatch(/sekret|abc123/u);
  });
});
