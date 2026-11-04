import { describe, expect, it } from "vitest";
import {
  COMMENT_CREATED,
  matchesEvent,
  NOTIFICATION_EVENTS,
  REVIEW_COMMENT_ALIAS,
} from "./event-match.ts";

const scoped = (scope: string): Record<string, unknown> => ({ scope, buildId: "b1" });

describe("matchesEvent", () => {
  it("matches the alias for build and story comments, never snapshot comments", () => {
    const alias = [REVIEW_COMMENT_ALIAS];
    expect(matchesEvent(alias, COMMENT_CREATED, scoped("build"))).toBe(true);
    expect(matchesEvent(alias, COMMENT_CREATED, scoped("story"))).toBe(true);
    expect(matchesEvent(alias, COMMENT_CREATED, scoped("snapshot"))).toBe(false);
    expect(matchesEvent(alias, COMMENT_CREATED, {})).toBe(false);
  });

  it("matches the canonical name for every scope, and an empty list matches everything", () => {
    for (const scope of ["build", "story", "snapshot"]) {
      expect(matchesEvent([COMMENT_CREATED], COMMENT_CREATED, scoped(scope))).toBe(true);
      expect(matchesEvent([], COMMENT_CREATED, scoped(scope))).toBe(true);
    }
    expect(matchesEvent([], "build:created", {})).toBe(true);
  });

  it("admits a comment once when both names are listed, snapshot comments by the canonical name", () => {
    const both = [REVIEW_COMMENT_ALIAS, COMMENT_CREATED];
    expect(matchesEvent(both, COMMENT_CREATED, scoped("story"))).toBe(true);
    expect(matchesEvent(both, COMMENT_CREATED, scoped("snapshot"))).toBe(true);
  });

  it("does not make the alias match other events or other names", () => {
    expect(matchesEvent([REVIEW_COMMENT_ALIAS], "review:verdict", scoped("build"))).toBe(false);
    expect(matchesEvent(["build:created"], COMMENT_CREATED, scoped("build"))).toBe(false);
  });
});

describe("NOTIFICATION_EVENTS", () => {
  it("lists each subscribable event once, with the review topics and without the alias", () => {
    const names = NOTIFICATION_EVENTS.map((entry) => entry.event);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(["review:requested", "review:verdict"]));
    expect(names).not.toContain(REVIEW_COMMENT_ALIAS);
    expect(names).not.toContain("comment:mentioned");
    expect(NOTIFICATION_EVENTS.every((entry) => entry.label.length > 0)).toBe(true);
  });
});
