import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShelfLogger, type PinoTransport } from "./logger.ts";

describe("createShelfLogger", () => {
  const LOG_LEVEL = "LOG_LEVEL";
  let savedLevel: string | undefined;

  beforeEach(() => {
    savedLevel = process.env[LOG_LEVEL];
  });

  afterEach(() => {
    if (savedLevel === undefined) {
      delete process.env["LOG_LEVEL"];
    } else {
      process.env[LOG_LEVEL] = savedLevel;
    }
  });
  it("returns a logger that emits structured JSON lines to stdout", () => {
    const logger = createShelfLogger({ level: "info" });
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.child).toBe("function");
  });

  it("defaults to info level", () => {
    delete process.env["LOG_LEVEL"];
    const logger = createShelfLogger();
    expect(logger.level).toBe("info");
  });

  it("reads the default level from LOG_LEVEL", () => {
    process.env[LOG_LEVEL] = "debug";
    const logger = createShelfLogger();
    expect(logger.level).toBe("debug");
  });

  it("prefers the explicit option over LOG_LEVEL", () => {
    process.env[LOG_LEVEL] = "debug";
    const logger = createShelfLogger({ level: "warn" });
    expect(logger.level).toBe("warn");
  });

  it("throws on unknown levels", () => {
    process.env[LOG_LEVEL] = "banana";
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
});
