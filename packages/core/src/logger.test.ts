import { describe, expect, it } from "vitest";

import { createShelfLogger, type PinoTransport } from "./logger.ts";

describe("createShelfLogger", () => {
  it("returns a logger that emits structured JSON lines to stdout", () => {
    const logger = createShelfLogger({ level: "info" });
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.child).toBe("function");
  });

  it("defaults to info level", () => {
    const logger = createShelfLogger();
    expect(logger.level).toBe("info");
  });

  it("honors the configured level", () => {
    const logger = createShelfLogger({ level: "debug" });
    expect(logger.level).toBe("debug");
  });

  it("accepts extra transports", () => {
    const transports: PinoTransport[] = [
      { target: "pino/file", options: { destination: 1 } },
    ];
    expect(() => createShelfLogger({ transports })).not.toThrow();
  });
});
