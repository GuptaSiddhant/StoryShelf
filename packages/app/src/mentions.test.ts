import type { User } from "@storyshelf/core/schema";
import { describe, expect, it } from "vitest";
import {
  MAX_SUGGESTIONS,
  completeMention,
  displayNameOf,
  handlesOf,
  mentionData,
  suggestMembers,
  typedMention,
} from "./mentions.ts";

const user = (id: string, name: string, extra: Partial<User> = {}): User => ({
  id,
  email: `${id}@example.com`,
  name,
  avatarUrl: null,
  role: "member",
  lastLoginAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

const person = (u: User) => ({ candidate: { userId: u.id, handles: handlesOf(u) }, user: u });

describe("displayNameOf and handlesOf", () => {
  it("shows the name a member set, else their sign-in name", () => {
    expect(displayNameOf(user("a", "Ada", { displayNameOverride: "Countess" }))).toBe("Countess");
    expect(displayNameOf(user("a", "Ada"))).toBe("Ada");
  });

  it("names a member by their email local part and their display name", () => {
    expect(handlesOf(user("ada.l", "Ada L", { displayNameOverride: "Countess" }))).toEqual([
      "ada.l",
      "Countess",
    ]);
  });
});

describe("typedMention", () => {
  it("finds what is being typed after the last @ that starts a word", () => {
    expect(typedMention("please ask @al")).toEqual({ start: 11, fragment: "al" });
    expect(typedMention("@")).toEqual({ start: 0, fragment: "" });
    expect(typedMention("cc @Alex D")).toEqual({ start: 3, fragment: "Alex D" });
  });

  it("finds nothing for an email address, no @, a new line or a long stretch", () => {
    expect(typedMention("mail ada@example.com")).toBeUndefined();
    expect(typedMention("no at sign")).toBeUndefined();
    expect(typedMention("@ada\nnext line")).toBeUndefined();
    expect(typedMention(`@${"x".repeat(41)}`)).toBeUndefined();
  });
});

describe("suggestMembers", () => {
  const people = [
    person(user("ada", "Ada Lovelace")),
    person(user("alex.doe", "Alex Doe")),
    person(user("bob", "Bob")),
  ];

  it("offers members whose handle or name starts with what was typed, by name", () => {
    expect(suggestMembers(people, "al")).toEqual([
      { userId: "alex.doe", handle: "alex.doe", name: "Alex Doe" },
    ]);
    expect(suggestMembers(people, "ada").map((item) => item.userId)).toEqual(["ada"]);
    expect(suggestMembers(people, "ALEX D").map((item) => item.userId)).toEqual(["alex.doe"]);
  });

  it("offers everyone for a bare @, up to the limit", () => {
    expect(suggestMembers(people, "").map((item) => item.userId)).toEqual([
      "ada",
      "alex.doe",
      "bob",
    ]);
    const many = Array.from({ length: 9 }, (_, index) =>
      person(user(`m${String(index)}`, `Member ${String(index)}`)),
    );
    expect(suggestMembers(many, "")).toHaveLength(MAX_SUGGESTIONS);
  });

  it("never offers a handle that would not resolve to that member alone", () => {
    const twins = [
      person(user("sam1", "Sam", { email: "sam@a.example" })),
      person(user("sam2", "Sam", { email: "sam@b.example" })),
    ];
    // Both are "sam" and "Sam": ambiguous, so neither can be offered.
    expect(suggestMembers(twins, "s")).toEqual([]);
    const mixed = [
      person(user("sam1", "Sam", { email: "sam@a.example" })),
      person(user("sam2", "Samuel", { email: "sam@b.example" })),
    ];
    // "sam" is both members' email local part, so only Samuel's unique name can be offered.
    expect(suggestMembers(mixed, "sam").map((item) => [item.userId, item.handle])).toEqual([
      ["sam2", "Samuel"],
    ]);
  });

  it("offers nobody for text that matches no one", () => {
    expect(suggestMembers(people, "zzz")).toEqual([]);
  });
});

describe("completeMention", () => {
  it("replaces what was typed with the chosen handle and a space", () => {
    const text = "ask @al";
    const typed = typedMention(text);
    expect(typed && completeMention(text, typed, "alex.doe")).toBe("ask @alex.doe ");
  });
});

describe("mentionData", () => {
  it("carries the comment id and the fields the verbose styles print", () => {
    const data = mentionData(
      {
        id: "c1",
        projectId: "p",
        buildId: "b1",
        snapshotId: null,
        storyId: "s1",
        userId: "u",
        body: "x".repeat(600),
        parentId: null,
        resolved: false,
        kind: "comment",
        resolvedAt: null,
        resolvedBy: null,
        createdAt: "",
        updatedAt: "",
      },
      "story",
      "Ada",
    );
    expect(data).toMatchObject({
      eventId: "c1",
      commentId: "c1",
      scope: "story",
      buildId: "b1",
      storyId: "s1",
      authorName: "Ada",
    });
    expect((data["message"] as string).length).toBe(500);
  });
});
