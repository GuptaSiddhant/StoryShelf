import { describe, expect, it } from "vitest";
import { chatNotifiers } from "./index.ts";

describe("chatNotifiers", () => {
  it("lists slack, teams and log with distinct kinds", () => {
    const kinds = chatNotifiers.map((provider) => provider.metadata.kind);
    expect(kinds).toEqual(["slack-webhook", "teams-workflow", "log"]);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("owns the kind `log`: the git providers name theirs `git-log` because it is taken", () => {
    expect(chatNotifiers.filter((provider) => provider.metadata.kind === "log")).toHaveLength(1);
  });
});
