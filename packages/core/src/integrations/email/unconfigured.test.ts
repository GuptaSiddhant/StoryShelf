import { describe, expect, it } from "vitest";
import { builtInEmailNotifier } from "./index.ts";
import { unconfiguredSender } from "./unconfigured.ts";

describe("unconfiguredSender", () => {
  it("fails a send with the fix named", async () => {
    await expect(
      unconfiguredSender().send({ to: "a@b.c", subject: "s", text: "t" }),
    ).rejects.toThrow("Email has no transport");
  });

  it("backs the built-in email notifier", () => {
    expect(builtInEmailNotifier().metadata.kind).toBe("email");
  });
});
