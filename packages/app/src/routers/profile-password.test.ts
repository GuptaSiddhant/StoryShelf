import { describe, expect, it } from "vitest";
import { hashProfilePassword, verifyProfilePassword } from "./profile-password.ts";

describe("profile password hashing", () => {
  it("round-trips a password", async () => {
    const hash = await hashProfilePassword("hunter2hunter2");
    await expect(verifyProfilePassword("hunter2hunter2", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashProfilePassword("hunter2hunter2");
    await expect(verifyProfilePassword("wrongpassword", hash)).resolves.toBe(false);
  });

  it("rejects malformed stored hashes", async () => {
    await expect(verifyProfilePassword("hunter2hunter2", "not-a-hash")).resolves.toBe(false);
    await expect(verifyProfilePassword("hunter2hunter2", "")).resolves.toBe(false);
  });
});
