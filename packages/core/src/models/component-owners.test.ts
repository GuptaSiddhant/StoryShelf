import { describe, expect, it } from "vitest";
import {
  assignOwners,
  compileOwnerPattern,
  matchesOwnerPattern,
  ownerRulesText,
  parseOwnerRules,
  readOwnerRules,
  serializeOwnerRules,
} from "./component-owners.ts";

const members = new Set(["ana", "bo", "cy"]);

describe("matchesOwnerPattern", () => {
  it.each([
    ["src/forms/**", "src/forms/Input.stories.tsx", true],
    ["src/forms/**", "src/forms/deep/Input.stories.tsx", true],
    ["src/forms/**", "src/charts/Bar.stories.tsx", false],
    ["src/*/Button.stories.tsx", "src/ui/Button.stories.tsx", true],
    ["src/*/Button.stories.tsx", "src/ui/x/Button.stories.tsx", false],
    ["**/*.stories.tsx", "a/b/c.stories.tsx", true],
    ["src/B?x.stories.tsx", "src/Box.stories.tsx", true],
    ["src/B?x.stories.tsx", "src/B/x.stories.tsx", false],
    ["src/forms/", "src/forms/Input.stories.tsx", true],
    ["/src/forms/**", "src/forms/Input.stories.tsx", true],
    ["src/a.b/**", "src/aXb/c.tsx", false],
    ["src/forms/**", "./src/forms/Input.stories.tsx", true],
    ["**/*.stories.tsx", "Button.stories.tsx", true],
    ["src/**/Button.stories.tsx", "src/Button.stories.tsx", true],
    ["src/**/Button.stories.tsx", "src/a/b/Button.stories.tsx", true],
    ["src/**/Button.stories.tsx", "srcX/Button.stories.tsx", false],
    ["src/**/Button.stories.tsx", "src/Card.stories.tsx", false],
    ["a", "ab", false],
    ["a", "a", true],
    ["src/forms", "src/forms/Input.tsx", false],
    ["**", "any/deep/file.tsx", true],
    ["*.tsx", "dir/file.tsx", false],
    ["**/**/x", "x", true],
    ["a/**/b/**/c", "a/q/b/r/s/c", true],
    ["a/**/b/**/c", "a/b/c", true],
    ["a/**/b/**/c", "a/q/c", false],
  ])("%s on %s is %s", (pattern, path, expected) => {
    expect(matchesOwnerPattern(pattern, path)).toBe(expected);
  });
});

describe("compileOwnerPattern", () => {
  it("answers a near-match path in linear time, however the wildcards nest", () => {
    // Regex engines backtrack on this: eight stars over a long path that almost matches.
    const matches = compileOwnerPattern("a*a*a*a*a*a*a*a*b.stories.tsx");
    const started = performance.now();

    expect(matches(`${"a".repeat(2000)}b.stories.ts`)).toBe(false);
    expect(matches(`${"a".repeat(2000)}b.stories.tsx`)).toBe(true);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("gives the same answers as matchesOwnerPattern, for many paths", () => {
    const matches = compileOwnerPattern("src/forms/**");

    expect(
      ["src/forms/A.tsx", "src/charts/B.tsx", "./src/forms/C.tsx"].map((path) => matches(path)),
    ).toEqual([true, false, true]);
  });
});

describe("parseOwnerRules", () => {
  it("reads rules, ignoring blank lines, comments and @ prefixes", () => {
    const text = [
      "# forms are Ana's, with Bo",
      "src/forms/**  ana @bo",
      "",
      "src/charts/**  cy # trailing comment",
    ].join("\n");

    expect(parseOwnerRules(text, members)).toEqual({
      rules: [
        { pattern: "src/forms/**", owners: ["ana", "bo"] },
        { pattern: "src/charts/**", owners: ["cy"] },
      ],
      problems: [],
    });
  });

  it("drops repeated owners on one line", () => {
    expect(parseOwnerRules("a/** ana ana @ana", members).rules).toEqual([
      { pattern: "a/**", owners: ["ana"] },
    ]);
  });

  it("rejects an owner who is not a member, naming the line", () => {
    const { problems } = parseOwnerRules("a/** ana\nb/** ana user_9Z\n", members);

    expect(problems).toEqual([{ line: 2, message: "user_9Z is not a member of this project." }]);
  });

  it("rejects a rule with no owners and reads CRLF line endings", () => {
    const { problems } = parseOwnerRules("a/** ana\r\nb/**\r\n", members);

    expect(problems).toEqual([{ line: 2, message: "no owners listed." }]);
  });

  it("refuses a pattern that is too long or has too many wildcards", () => {
    const long = `${"a".repeat(201)}/** ana`;
    const wild = `${"**/".repeat(5)}x ana`;
    const fine = `${"**/".repeat(4)}x ana`;

    expect(parseOwnerRules(long, members).problems).toEqual([
      { line: 1, message: "the pattern is longer than 200 characters." },
    ]);
    expect(parseOwnerRules(wild, members).problems).toEqual([
      { line: 1, message: "the pattern has more than 8 wildcards." },
    ]);
    expect(parseOwnerRules(fine, members)).toMatchObject({ problems: [] });
  });

  it("is empty for empty text", () => {
    expect(parseOwnerRules("", members)).toEqual({ rules: [], problems: [] });
    expect(parseOwnerRules("# only a comment\n\n", members)).toEqual({ rules: [], problems: [] });
  });
});

describe("storage", () => {
  it("round-trips through JSON and text", () => {
    const rules = [{ pattern: "a/**", owners: ["ana", "bo"] }];

    expect(readOwnerRules(serializeOwnerRules(rules))).toEqual(rules);
    expect(ownerRulesText(rules)).toBe("a/**  ana  bo");
    expect(parseOwnerRules(ownerRulesText(rules), members).rules).toEqual(rules);
  });

  it("stores no rules as null", () => {
    expect(serializeOwnerRules([])).toBeNull();
  });

  it.each([null, undefined, "", "not json", "{}", '"x"', '[{"pattern":1}]', '[{"owners":[]}]'])(
    "reads %j as no rules",
    (stored) => {
      expect(readOwnerRules(stored)).toEqual([]);
    },
  );

  it("keeps the valid rules of a list and drops the rest", () => {
    const stored = JSON.stringify([{ pattern: "a/**", owners: ["ana"] }, { pattern: 3 }, null]);

    expect(readOwnerRules(stored)).toEqual([{ pattern: "a/**", owners: ["ana"] }]);
  });
});

describe("assignOwners", () => {
  const rules = [
    { pattern: "src/forms/**", owners: ["ana", "bo"] },
    { pattern: "src/**/Input.stories.tsx", owners: ["bo", "cy"] },
  ];

  it("gives a file the owners of every rule it matches (union), in rule order", () => {
    const assigned = assignOwners(rules, ["src/forms/Input.stories.tsx"], members);

    expect(assigned).toEqual([
      { userId: "ana", paths: ["src/forms/Input.stories.tsx"] },
      { userId: "bo", paths: ["src/forms/Input.stories.tsx"] },
      { userId: "cy", paths: ["src/forms/Input.stories.tsx"] },
    ]);
  });

  it("lists each owner once with all their files", () => {
    const assigned = assignOwners(
      rules,
      ["src/forms/B.stories.tsx", "src/forms/A.stories.tsx", "src/charts/C.stories.tsx"],
      members,
    );

    expect(assigned).toEqual([
      { userId: "ana", paths: ["src/forms/A.stories.tsx", "src/forms/B.stories.tsx"] },
      { userId: "bo", paths: ["src/forms/A.stories.tsx", "src/forms/B.stories.tsx"] },
    ]);
  });

  it("assigns nobody when no file matches or there are no files", () => {
    expect(assignOwners(rules, ["src/charts/C.stories.tsx"], members)).toEqual([]);
    expect(assignOwners(rules, [], members)).toEqual([]);
    expect(assignOwners([], ["src/forms/A.stories.tsx"], members)).toEqual([]);
  });

  it("skips an owner who is no longer a member", () => {
    const assigned = assignOwners(rules, ["src/forms/A.stories.tsx"], new Set(["ana"]));

    expect(assigned.map((owner) => owner.userId)).toEqual(["ana"]);
  });
});
