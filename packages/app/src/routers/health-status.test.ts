import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectStatusRows,
  hostingRow,
  imageEngineRow,
  publicOriginRow,
  telemetryRow,
} from "./health-status.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("telemetryRow", () => {
  it("is off without an endpoint", () => {
    expect(telemetryRow({})).toMatchObject({ value: "off", tone: "off" });
  });

  it("is off when the SDK is disabled, whatever the endpoint", () => {
    const env = { OTEL_EXPORTER_OTLP_ENDPOINT: "http://c:4318", OTEL_SDK_DISABLED: "true" };
    expect(telemetryRow(env).value).toBe("off");
  });

  it("names the exporter origin only, never the path, credentials or headers", () => {
    const row = telemetryRow({
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://user:pw@otel.example.com:4318/v1/traces?key=abc",
      OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer topsecret",
    });
    expect(row).toMatchObject({ value: "on", tone: "ok" });
    expect(row.detail).toBe("exporting to https://otel.example.com:4318");
    expect(JSON.stringify(row)).not.toMatch(/topsecret|pw|abc|v1\/traces/u);
  });

  it("honours SHELF_OTEL_ENABLED without an endpoint", () => {
    const row = telemetryRow({ SHELF_OTEL_ENABLED: "true" });
    expect(row.value).toBe("on");
    expect(row.detail).toBe("exporter host not set");
  });
});

describe("imageEngineRow", () => {
  it("reports the runner's engine and its diff workers", () => {
    const state = vi.fn(() => ({ engine: "sharp" as const, workers: 3, inThread: false }));
    expect(imageEngineRow({ state })).toEqual({
      id: "image-engine",
      label: "Image engine",
      value: "sharp",
      tone: "ok",
      detail: "3 diff workers",
    });
  });

  it("notes diffs on the main thread", () => {
    const state = vi.fn(() => ({ engine: "pngjs" as const, workers: 0, inThread: true }));
    expect(imageEngineRow({ state }).detail).toBe("diffs run on the main thread");
  });

  it("reads off without testing: a hosting-only instance has no image engine", () => {
    expect(imageEngineRow()).toMatchObject({ value: "off", tone: "off", detail: "no testing" });
  });
});

describe("publicOriginRow", () => {
  it("is not tracked without a resolver", async () => {
    expect((await publicOriginRow()).tone).toBe("off");
  });

  it("is confirmed with the source when one resolves", async () => {
    const row = await publicOriginRow({
      resolve: async () => ({ url: "https://shelf.example.com", source: "config" }),
    } as never);
    expect(row).toMatchObject({ value: "confirmed", tone: "ok" });
    expect(row.detail).toBe("https://shelf.example.com (config)");
  });

  it("warns, and says why, when nothing is confirmed", async () => {
    const reported = await publicOriginRow({
      resolve: async () => null,
      stored: async () => ({ origin: "https://x.example.com", confirmed: false }),
    } as never);
    expect(reported).toMatchObject({ value: "not confirmed", tone: "warn" });
    expect(reported.detail).toContain("no admin confirmed");
    const none = await publicOriginRow({
      resolve: async () => null,
      stored: async () => null,
    } as never);
    expect(none.detail).toContain("none configured");
    expect(none.detail).toContain("not sent");
  });
});

describe("hostingRow", () => {
  it("defaults to trusted", () => {
    expect(hostingRow({} as never)).toMatchObject({ value: "trusted" });
  });

  it("shows the content host in subdomain mode", () => {
    const row = hostingRow({
      storybookHosting: { mode: "subdomain", baseDomain: "shelf.example.com" },
    } as never);
    expect(row).toMatchObject({ value: "subdomain", detail: "content host *.shelf.example.com" });
  });
});

describe("collectStatusRows", () => {
  it("returns the four rows in order", async () => {
    const rows = await collectStatusRows({ env: {}, config: {} as never });
    expect(rows.map((row) => row.id)).toEqual([
      "telemetry",
      "image-engine",
      "public-origin",
      "hosting",
    ]);
  });
});
