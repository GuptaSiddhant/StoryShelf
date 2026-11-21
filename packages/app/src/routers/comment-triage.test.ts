import type { AuthUser } from "@storyshelf/core/types";
import { describe, expect, it } from "vitest";
import { runWithStore, type Store } from "../store.ts";
import { isBuildAuthor } from "./comment-triage.ts";
import { reviewCapabilities } from "./review-section.handlers.ts";

const ADA: AuthUser = { id: "u1", email: "Ada@Example.test", name: "Ada", role: "admin" };

async function as<T>(user: AuthUser | null, run: () => Promise<T> | T): Promise<T> {
  let result: T | undefined;
  await runWithStore({ config: {}, authEnabled: true, user } as Store, async () => {
    result = await run();
  });
  return result as T;
}

describe("isBuildAuthor", () => {
  it("matches the signed-in user's email case-insensitively", async () => {
    expect(await as(ADA, () => isBuildAuthor({ authorEmail: "ada@example.test" }))).toBe(true);
    expect(await as(ADA, () => isBuildAuthor({ authorEmail: "bo@example.test" }))).toBe(false);
    expect(await as(null, () => isBuildAuthor({ authorEmail: "ada@example.test" }))).toBe(false);
  });

  it("is never true for a read-only shared account (#1274)", async () => {
    const shared = { ...ADA, readOnly: true };
    expect(await as(shared, () => isBuildAuthor({ authorEmail: "ada@example.test" }))).toBe(false);
  });
});

describe("reviewCapabilities", () => {
  it("grants a read-only shared account nothing, whatever its role (#1274)", async () => {
    const shared = { ...ADA, readOnly: true };
    expect(await as(shared, async () => await reviewCapabilities({ id: "p1" } as never))).toEqual({
      canComment: false,
      canVerdict: false,
    });
  });
});
