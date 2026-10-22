import { describe, expect, it } from "vitest";
import { describeExit } from "./exit.ts";

describe("describeExit", () => {
  it("names the signal that killed the child, else its exit code", () => {
    expect(describeExit({ code: null, signal: "SIGKILL" })).toBe("signal SIGKILL");
    expect(describeExit({ code: 1, signal: null })).toBe("code 1");
    expect(describeExit({ code: 0, signal: null })).toBe("code 0");
  });
});
