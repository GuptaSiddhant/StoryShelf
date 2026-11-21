import { UserModel } from "@storyshelf/core/models";
import { makeDatabase } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { databaseDeps } from "./demo-viewer-db.ts";
import { DEMO_VIEWER_EMAIL } from "./demo-viewer.ts";

const PASSWORD = "throwaway-demo-password-1";

describe("databaseDeps", () => {
  it("creates the demo account with the site role member", async () => {
    const { db } = makeDatabase();
    const id = await databaseDeps(db).createUser(DEMO_VIEWER_EMAIL, PASSWORD);
    expect((await new UserModel(db).get(id))?.role).toBe("member");
  });

  it("sets an existing site viewer back to member, once", async () => {
    const { db } = makeDatabase();
    const deps = databaseDeps(db);
    const id = await deps.createUser(DEMO_VIEWER_EMAIL, PASSWORD);
    await db.update(db.tables.users, id, { role: "viewer" });
    await expect(deps.ensureSiteMember(id)).resolves.toBe(true);
    expect((await new UserModel(db).get(id))?.role).toBe("member");
    await expect(deps.ensureSiteMember(id)).resolves.toBe(false);
  });
});
