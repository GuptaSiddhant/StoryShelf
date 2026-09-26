import { makeDatabase } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { createAccountAuth } from "./accounts.ts";

describe("createAccountAuth invite-only", () => {
  it("issues an invite, accepts it, and logs in", async () => {
    const { db } = makeDatabase();
    const auth = createAccountAuth({ db, secret: "s3cr3t" });
    const { inviteId, token } = await auth.issueInvite({
      email: "ada@example.com",
      name: "Ada",
      role: "admin",
    });
    expect(inviteId).toBeTruthy();
    expect(token).toContain("inv_");
    const user = await auth.acceptInvite({ inviteId, token, password: "hunter2hunter2" });
    expect(user.email).toBe("ada@example.com");
    const session = await auth.loginWithCredentials("ada@example.com", "hunter2hunter2");
    expect(session).toContain(".");
    expect(
      await auth.loginWithCredentials("ada@example.com", "wrongpass12").then(
        () => false,
        () => true,
      ),
    ).toBe(true);
    const req = new Request("https://example.com/", {
      headers: { cookie: `storyshelf_session=${session}` },
    });
    const checked = await auth.check(req);
    expect(checked?.email).toBe("ada@example.com");
    await db.lifecycle?.teardown();
  });

  it("rejects reused or expired invites", async () => {
    const { db } = makeDatabase();
    const auth = createAccountAuth({ db, secret: "s3cr3t", inviteExpiryMs: 10 });
    const { inviteId, token } = await auth.issueInvite({
      email: "bob@example.com",
      name: "Bob",
      role: "member",
    });
    await auth.acceptInvite({ inviteId, token, password: "hunter2hunter2" });
    await expect(
      auth.acceptInvite({ inviteId, token, password: "hunter2hunter2" }),
    ).rejects.toThrow(/Invalid or expired/u);
    const { inviteId: id2, token: tok2 } = await auth.issueInvite({
      email: "carol@example.com",
      name: "Carol",
      role: "member",
    });
    await new Promise((r) => setTimeout(r, 20));
    await expect(
      auth.acceptInvite({ inviteId: id2, token: tok2, password: "hunter2hunter2" }),
    ).rejects.toThrow(/Invalid or expired/u);
    await db.lifecycle?.teardown();
  });
});
