import type { AuthUser } from "@storyshelf/core/types";
import { describe, expect, it } from "vitest";
import { canConnect } from "./connections.ts";
import { runWithStore, type Store } from "./store.ts";

const ADA: AuthUser = { id: "u1", email: "ada@example.test", name: "Ada", role: "member" };

async function connectable(user: AuthUser | null, secret?: string): Promise<boolean> {
  let result = false;
  await runWithStore({ authEnabled: true, user, config: { secret } } as Store, async () => {
    result = canConnect();
    await Promise.resolve();
  });
  return result;
}

describe("canConnect", () => {
  it("needs a signed-in user and a server secret", async () => {
    expect(await connectable(ADA, "s".repeat(32))).toBe(true);
    expect(await connectable(null, "s".repeat(32))).toBe(false);
    expect(await connectable(ADA)).toBe(false);
  });

  it("is never true for a read-only shared account (#1274)", async () => {
    expect(await connectable({ ...ADA, readOnly: true }, "s".repeat(32))).toBe(false);
  });
});
