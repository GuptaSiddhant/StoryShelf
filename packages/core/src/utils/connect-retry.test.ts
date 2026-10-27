import { describe, expect, it, vi } from "vitest";
import { isRetryableConnectError, retryConnect } from "./connect-retry.ts";

const noSleep = async (): Promise<void> => await Promise.resolve();

describe("isRetryableConnectError", () => {
  it.each([
    "connect ECONNREFUSED 127.0.0.1:3000",
    "WebSocket error: socket hang up",
    "ws closed: Connection closed",
    "Timeout 30000ms exceeded",
    "Unexpected server response: 503",
    "429 Too Many Requests",
    "no capacity: all parallel sessions are in use",
  ])("retries %s", (message) => {
    expect(isRetryableConnectError(new Error(message))).toBe(true);
  });

  it.each([
    "Unexpected server response: 401",
    "403 Forbidden",
    "404 not found",
    "428 Precondition Required: Playwright version mismatch",
    "something else entirely",
  ])("does not retry %s", (message) => {
    expect(isRetryableConnectError(new Error(message))).toBe(false);
  });

  it("reads a thrown non-error as text", () => {
    expect(isRetryableConnectError("ECONNRESET")).toBe(true);
  });
});

describe("retryConnect", () => {
  it("returns at once when the first attempt connects", async () => {
    const connect = vi.fn(async () => await Promise.resolve("browser"));
    await expect(retryConnect(connect, { retries: 3, backoffMs: 1, sleep: noSleep })).resolves.toBe(
      "browser",
    );
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("retries a connection failure with growing delays and reports each retry", async () => {
    const delays: number[] = [];
    const retries: number[] = [];
    let attempts = 0;
    const result = await retryConnect(
      async () => {
        attempts += 1;
        if (attempts < 4) {
          throw new Error("ECONNRESET");
        }
        return await Promise.resolve("up");
      },
      {
        retries: 3,
        backoffMs: 100,
        sleep: async (ms) => {
          delays.push(ms);
          await Promise.resolve();
        },
        onRetry: (_error, retry) => {
          retries.push(retry);
        },
      },
    );
    expect(result).toBe("up");
    expect(retries).toEqual([1, 2, 3]);
    expect(delays[0]).toBeGreaterThanOrEqual(75);
    expect(delays[0]).toBeLessThanOrEqual(125);
    expect(delays[2]).toBeGreaterThanOrEqual(300);
  });

  it("throws the last error once the retries are spent", async () => {
    const connect = vi.fn(async () => await Promise.reject(new Error("ECONNREFUSED")));
    await expect(
      retryConnect(connect, { retries: 2, backoffMs: 1, sleep: noSleep }),
    ).rejects.toThrow("ECONNREFUSED");
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it("does not retry a permanent failure", async () => {
    const connect = vi.fn(async () => await Promise.reject(new Error("401 Unauthorized")));
    await expect(
      retryConnect(connect, { retries: 3, backoffMs: 1, sleep: noSleep }),
    ).rejects.toThrow("401");
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("waits for real when no sleep is injected", async () => {
    let attempts = 0;
    await retryConnect(
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("ECONNRESET");
        return await Promise.resolve();
      },
      { retries: 1, backoffMs: 1 },
    );
    expect(attempts).toBe(2);
  });

  it("takes its own rule for what is worth retrying", async () => {
    const connect = vi.fn(async () => await Promise.reject(new Error("anything")));
    await expect(
      retryConnect(connect, { retries: 2, backoffMs: 1, sleep: noSleep, retryable: () => true }),
    ).rejects.toThrow("anything");
    expect(connect).toHaveBeenCalledTimes(3);
  });
});
