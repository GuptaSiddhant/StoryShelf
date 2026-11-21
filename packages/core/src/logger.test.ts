import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShelfLogger, type PinoTransport } from "./logger.ts";

describe("createShelfLogger", () => {
  const SHELF_LOG_LEVEL = "SHELF_LOG_LEVEL";
  let savedLevel: string | undefined;

  beforeEach(() => {
    savedLevel = process.env[SHELF_LOG_LEVEL];
  });

  afterEach(() => {
    if (savedLevel === undefined) {
      delete process.env.SHELF_LOG_LEVEL;
    } else {
      process.env[SHELF_LOG_LEVEL] = savedLevel;
    }
  });
  it("returns a logger that emits structured JSON lines to stdout", () => {
    const logger = createShelfLogger({ level: "info" });
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.child).toBe("function");
  });

  it("defaults to info level", () => {
    delete process.env.SHELF_LOG_LEVEL;
    const logger = createShelfLogger();
    expect(logger.level).toBe("info");
  });

  it("reads the default level from SHELF_LOG_LEVEL", () => {
    process.env[SHELF_LOG_LEVEL] = "debug";
    const logger = createShelfLogger();
    expect(logger.level).toBe("debug");
  });

  it("prefers the explicit option over SHELF_LOG_LEVEL", () => {
    process.env[SHELF_LOG_LEVEL] = "debug";
    const logger = createShelfLogger({ level: "warn" });
    expect(logger.level).toBe("warn");
  });

  it("throws on unknown levels", () => {
    process.env[SHELF_LOG_LEVEL] = "banana";
    expect(() => createShelfLogger()).toThrow();
  });

  it("honors the configured level", () => {
    const logger = createShelfLogger({ level: "debug" });
    expect(logger.level).toBe("debug");
  });

  it("accepts extra transports", () => {
    const transports: PinoTransport[] = [{ target: "pino/file", options: { destination: 1 } }];
    expect(() => createShelfLogger({ transports })).not.toThrow();
  });

  it("accepts a log-line mixin", () => {
    expect(() => createShelfLogger({ mixin: () => ({ trace_id: "abc" }) })).not.toThrow();
  });
});
