import { describe, expect, it } from "vitest";
import { mentionSpans, resolveMentions, type MentionCandidate } from "./mentions.ts";

const alex: MentionCandidate = { userId: "u-alex", handles: ["alex.doe", "Alex Doe"] };
const sam: MentionCandidate = { userId: "u-sam", handles: ["sam", "Sam Lee"] };
const members = [alex, sam];

const ids = (body: string, candidates = members) =>
  resolveMentions(body, candidates).map((mention) => mention.userId);

describe("resolveMentions", () => {
  it("resolves an email local part and a display name, case-insensitively", () => {
    expect(resolveMentions("hi @alex.doe", members)).toEqual([
      { userId: "u-alex", handle: "alex.doe" },
    ]);
    expect(resolveMentions("hi @ALEX DOE!", members)).toEqual([
      { userId: "u-alex", handle: "ALEX DOE" },
    ]);
    expect(ids("@Sam Lee and @sam")).toEqual(["u-sam"]);
  });

  it("keeps text that names no member as plain text", () => {
    expect(ids("ping @nobody and @alexa")).toEqual([]);
    expect(ids("")).toEqual([]);
    expect(ids("no mentions here")).toEqual([]);
  });

  it("does not take an email address, or a word glued to @, for a mention", () => {
    expect(ids("mail sam@example.com")).toEqual([]);
    expect(ids("mail alex.doe@example.com")).toEqual([]);
    expect(ids("price@sam")).toEqual([]);
  });

  it("ends a handle at punctuation, including a sentence-ending full stop", () => {
    expect(ids("thanks @alex.doe.")).toEqual(["u-alex"]);
    expect(ids("(@sam), @alex.doe: look")).toEqual(["u-sam", "u-alex"]);
  });

  it("does not match a handle that is only the start of a longer one", () => {
    expect(ids("@alex.doe.smith")).toEqual([]);
    expect(ids("@sam-jones")).toEqual([]);
    expect(ids("@samuel")).toEqual([]);
  });

  it("prefers the longer handle", () => {
    const candidates = [
      { userId: "u1", handles: ["sam"] },
      { userId: "u2", handles: ["sam lee"] },
    ];
    expect(ids("@sam lee please", candidates)).toEqual(["u2"]);
    expect(ids("@sam please", candidates)).toEqual(["u1"]);
  });

  it("drops a handle two members share rather than guess", () => {
    const candidates = [
      { userId: "u1", handles: ["sam", "Sam Lee"] },
      { userId: "u2", handles: ["sam", "Sam Park"] },
    ];
    expect(ids("@sam", candidates)).toEqual([]);
    expect(ids("@Sam Lee and @Sam Park", candidates)).toEqual(["u1", "u2"]);
  });

  it("does not fall back to a shorter unique handle when a longer one is shared", () => {
    const candidates = [
      { userId: "u1", handles: ["alex1", "Alex Smith"] },
      { userId: "u2", handles: ["alexs", "Alex Smith"] },
      { userId: "u3", handles: ["alex.t", "Alex"] },
    ];
    expect(ids("@Alex Smith please", candidates)).toEqual([]);
    expect(ids("@Alex please", candidates)).toEqual(["u3"]);
  });

  it("returns one entry per member, the first mention winning", () => {
    expect(resolveMentions("@sam then @Sam Lee then @sam", members)).toEqual([
      { userId: "u-sam", handle: "sam" },
    ]);
  });

  it("ignores blank handles and takes no regex metacharacter specially", () => {
    const odd = [{ userId: "u9", handles: ["", "  ", "a+b (c)"] }];
    expect(ids("@a+b (c) ok", odd)).toEqual(["u9"]);
    expect(ids("@ ", odd)).toEqual([]);
  });

  it("matches non-ASCII names", () => {
    const candidates = [{ userId: "u7", handles: ["Zoë Ünal"] }];
    expect(ids("cc @zoë ünal.", candidates)).toEqual(["u7"]);
  });
});

describe("mentionSpans", () => {
  const stored = [
    { userId: "u-alex", handle: "alex.doe" },
    { userId: "u-sam", handle: "Sam Lee" },
  ];

  it("finds each stored mention where it sits, so a renamed member still renders", () => {
    const body = "cc @alex.doe and @sam lee.";
    const spans = mentionSpans(body, stored);
    expect(spans.map((span) => [span.userId, body.slice(span.start, span.end)])).toEqual([
      ["u-alex", "@alex.doe"],
      ["u-sam", "@sam lee"],
    ]);
  });

  it("leaves text that was plain when the comment was posted plain", () => {
    expect(mentionSpans("hello @sam", stored)).toEqual([]);
    expect(mentionSpans("hello @sam", [])).toEqual([]);
  });
});
