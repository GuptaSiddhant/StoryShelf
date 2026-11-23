import { describe, expect, it } from "vitest";
import { satisfies } from "./semver-lite.ts";

describe("satisfies", () => {
  it.each([
    ["0.14.0", "0.14.0", true],
    ["0.14.1", "0.14.0", false],
    ["3.1158.0", "^3.700.0", true],
    ["4.0.0", "^3.700.0", false],
    ["0.18.2", "^0.18.0", true],
    ["0.19.0", "^0.18.0", false],
    ["0.0.3", "^0.0.3", true],
    ["0.0.4", "^0.0.3", false],
    ["8.23.1", "~8.23.0", true],
    ["8.24.0", "~8.23.0", false],
    ["0.34.0", ">=0.34.0", true],
    ["0.33.9", ">=0.34.0", false],
    ["12.1.0", "^11.0.0 || ^12.0.0", true],
    ["13.0.0", "^11.0.0 || ^12.0.0", false],
    ["1.2.3", ">=1.0.0 <2.0.0", true],
    ["2.0.0", ">=1.0.0 <2.0.0", false],
    ["5.0.0", "*", true],
    ["1.0.0-rc.6", "^1.0.0-rc.6", true],
    ["1.0.0-rc.5", "^1.0.0-rc.6", false],
    ["1.0.0", "^1.0.0-rc.6", true],
    ["1.0.0-rc.6", "^1.0.0", false],
    ["not a version", "^1.0.0", false],
  ])("%s against %s is %s", (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });
});
