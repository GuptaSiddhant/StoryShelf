import { describe, expect, it } from "vitest";
import { azureKey } from "./keys.ts";

describe("azureKey", () => {
  it("joins a prefix and path into a blob name", () => {
    expect(azureKey("", "a/b.txt")).toBe("a/b.txt");
    expect(azureKey("app", "a/b.txt")).toBe("app/a/b.txt");
    expect(azureKey("app", "")).toBe("app/");
  });
});
