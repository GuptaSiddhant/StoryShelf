import { createShelfLogger } from "@storyshelf/core/logger";
import { MemberModel, ProjectModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { memberIdentityOf } from "./settings-members.tsx";

const user = { email: "ada@example.com", name: "Ada Lovelace", displayNameOverride: null };

describe("memberIdentityOf", () => {
  it("shows the display name the user chose over the profile name", () => {
    expect(memberIdentityOf({ ...user, displayNameOverride: "Ada L." })).toEqual({
      name: "Ada L.",
      email: "ada@example.com",
    });
  });

  it("falls back to the profile name, then to the email", () => {
    expect(memberIdentityOf(user)).toEqual({ name: "Ada Lovelace", email: "ada@example.com" });
    expect(memberIdentityOf({ ...user, name: "  " })).toEqual({
      name: "ada@example.com",
      email: "ada@example.com",
    });
  });

  it("never shows an address as the name, though the email is still shown", () => {
    expect(memberIdentityOf({ ...user, name: "ada@example.com" })).toEqual({
      name: "ada@example.com",
      email: "ada@example.com",
    });
  });

  it("says a member with no account row is an unknown user, not an id", () => {
    expect(memberIdentityOf(null)).toEqual({ name: "Unknown user", email: null });
  });
});

type TestUser = { id: string; email: string; name: string; displayNameOverride?: string };

/** The access tab for a project with these users on the roster and these member ids. */
async function accessHtml(users: TestUser[], memberIds: string[]): Promise<string> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await new ProjectModel(db).create({ name: "Docs" });
  await Promise.all(
    users.map((row) =>
      db.insert(db.tables.users, {
        displayNameOverride: null,
        role: "member",
        avatarUrl: null,
        lastLoginAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        ...row,
      }),
    ),
  );
  await Promise.all(
    memberIds.map((memberId) => new MemberModel(db).set(project.id, memberId, "viewer")),
  );
  const app = createShelfApp({
    database: db,
    storage,
    logger: createShelfLogger({ level: "silent" }),
  });
  return await (await app.request("/projects/docs/settings/access")).text();
}

describe("the access tab's roster", () => {
  it("shows a member's display name and email, never the user id", async () => {
    const html = await accessHtml(
      [
        {
          id: "ada-id",
          email: "ada@example.com",
          name: "Ada Lovelace",
          displayNameOverride: "Ada L.",
        },
      ],
      ["ada-id"],
    );
    expect(html).toContain("Ada L.");
    expect(html).toContain("ada@example.com");
    // The Remove form's URL carries the id; the visible label never does.
    expect(html).not.toMatch(/>ada-id</u);
  });

  it("says a member whose account row is gone is an unknown user, with no id", async () => {
    const html = await accessHtml([], ["gone-id"]);
    expect(html).toContain("Unknown user");
    expect(html).not.toMatch(/>gone-id</u);
  });

  it("shows an email that is also the name once, with no repeat in the details", async () => {
    const html = await accessHtml(
      [{ id: "li-id", email: "li@example.com", name: "li@example.com" }],
      ["li-id"],
    );
    expect(html.split("li@example.com").length - 1).toBe(1);
  });
});
