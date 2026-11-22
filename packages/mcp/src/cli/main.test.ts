import { describe, expect, it } from "vitest";
import { subcommandOf } from "./main.ts";

describe("subcommandOf", () => {
  it("names init and serve, and nothing else", () => {
    expect(subcommandOf(["init", "--dir", "x"])).toBe("init");
    expect(subcommandOf(["serve"])).toBe("serve");
    expect(subcommandOf([])).toBeUndefined();
    expect(subcommandOf(["--http"])).toBeUndefined();
    expect(subcommandOf(["http", "init"])).toBeUndefined();
  });
});
