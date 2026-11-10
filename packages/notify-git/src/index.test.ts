import { describe, expect, it } from "vite-plus/test";
import { gitNotifiers } from "./index.ts";

describe("gitNotifiers", () => {
  it("lists github, gitlab and git-log as state providers with distinct kinds", () => {
    expect(gitNotifiers.map((provider) => provider.metadata.kind)).toEqual([
      "github",
      "gitlab",
      "git-log",
    ]);
    expect(gitNotifiers.every((provider) => provider.metadata.delivery === "state")).toBe(true);
  });
});
