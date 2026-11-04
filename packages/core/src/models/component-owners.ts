/**
 * Component ownership (#465): a project-level map from story-file globs to member user ids,
 * written CODEOWNERS-style (`src/components/forms/**  user_01H  user_02J`). It is stored as JSON in
 * `projects.component_owners` and only decides who is asked to review a build; approval rules do
 * not read it. Everything here is pure: callers pass the project's member ids.
 */

/** One rule: a story-file glob and the members who own what it matches. */
export interface OwnerRule {
  pattern: string;
  owners: string[];
}

/** Why a line of the rules text was refused. */
export interface OwnerProblem {
  /** 1-based line in the text the admin submitted. */
  line: number;
  message: string;
}

/** The outcome of parsing rules text: nothing is saved unless `problems` is empty. */
export interface ParsedOwnerRules {
  rules: OwnerRule[];
  problems: OwnerProblem[];
}

/** A reviewer the owners map assigns to a build, with the story files that put them there. */
export interface AssignedOwner {
  userId: string;
  /** Story files (changed in the build) that matched one of their rules. */
  paths: string[];
}

/**
 * Bounds on one pattern. Patterns are matched on every build page view and every review request, so
 * a pattern with many wildcards (which the matcher turns into nested backtracking) or a very long
 * one is refused when saved rather than left to slow the server.
 */
export const MAX_PATTERN_LENGTH = 200;
export const MAX_PATTERN_WILDCARDS = 8;

/** Regex-special characters escaped when a glob is translated. */
const REGEX_SPECIALS = new Set(["+", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\", "."]);

/**
 * A single star stays within a folder; a double star crosses folders. A double star followed by a
 * slash also matches no folder at all, so a pattern like `src/<double star>/Button.stories.tsx`
 * matches `src/Button.stories.tsx`, and a leading one matches a file at the root.
 */
function starToken(pattern: string, index: number): { text: string; advance: number } {
  if (pattern[index + 1] !== "*") {
    return { text: "[^/]*", advance: 1 };
  }
  return pattern[index + 2] === "/" ? { text: "(?:.*/)?", advance: 3 } : { text: ".*", advance: 2 };
}

/** Translate the glob token at `index` into regex text and how far to advance. */
function translateToken(pattern: string, index: number): { text: string; advance: number } {
  const char = pattern[index];
  if (char === "*") {
    return starToken(pattern, index);
  }
  if (char === "?") {
    return { text: "[^/]", advance: 1 };
  }
  return {
    text: char !== undefined && REGEX_SPECIALS.has(char) ? `\\${char}` : (char ?? ""),
    advance: 1,
  };
}

/**
 * A pattern with a leading `./` or `/` dropped, and a trailing `/` read as "everything below":
 * `src/forms/` matches like `src/forms/**`.
 */
function normalizePattern(pattern: string): string {
  const bare = pattern.replace(/^\.?\//u, "");
  return bare.endsWith("/") ? `${bare}**` : bare;
}

/**
 * A matcher for one glob (`*` within a folder, `**` across folders, `?`), compiled once so it can
 * be tried against many story files.
 */
export function compileOwnerPattern(pattern: string): (path: string) => boolean {
  const glob = normalizePattern(pattern);
  const parts: string[] = [];
  let index = 0;
  while (index < glob.length) {
    const token = translateToken(glob, index);
    parts.push(token.text);
    index += token.advance;
  }
  const expression = new RegExp(`^${parts.join("")}$`, "u");
  return (path) => expression.test(path.replace(/^\.?\//u, ""));
}

/** Whether a story file path matches a glob. */
export function matchesOwnerPattern(pattern: string, path: string): boolean {
  return compileOwnerPattern(pattern)(path);
}

/** The text of one line without its `#` comment, split into words. */
function wordsOf(line: string): string[] {
  const hash = line.indexOf("#");
  return (hash === -1 ? line : line.slice(0, hash)).split(/\s+/u).filter((word) => word !== "");
}

/** The owners a line names, `@` prefixes dropped and repeats removed. */
function ownersOf(words: readonly string[]): string[] {
  return [...new Set(words.map((word) => word.replace(/^@/u, "")))];
}

/** Problems of one rule line: owners that are not members of the project. */
function problemsOf(
  line: number,
  owners: readonly string[],
  members: ReadonlySet<string>,
): OwnerProblem[] {
  return owners
    .filter((owner) => !members.has(owner))
    .map((owner) => ({ line, message: `${owner} is not a member of this project.` }));
}

/**
 * Parse CODEOWNERS-style text. A line is a glob followed by one or more member ids; blank lines and
 * `#` comments are ignored. A line with no owner, or with an id that is not in `memberIds`, is a
 * problem (reported by its line number); the caller saves only when there are none.
 */
export function parseOwnerRules(text: string, memberIds: ReadonlySet<string>): ParsedOwnerRules {
  const parsed = text.split(/\r?\n/u).map((line, index) => parseLine(line, index + 1, memberIds));
  return {
    rules: parsed.flatMap((item) => (item.rule === undefined ? [] : [item.rule])),
    problems: parsed.flatMap((item) => item.problems),
  };
}

/** Why a pattern is refused (too long, too many wildcards), or null when it is fine. */
function patternRefusal(pattern: string): string | null {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return `the pattern is longer than ${String(MAX_PATTERN_LENGTH)} characters.`;
  }
  const wildcards = pattern.split("").filter((char) => char === "*" || char === "?").length;
  return wildcards > MAX_PATTERN_WILDCARDS
    ? `the pattern has more than ${String(MAX_PATTERN_WILDCARDS)} wildcards.`
    : null;
}

/** One line's rule (none for a blank or comment line) and what is wrong with it. */
function parseLine(
  line: string,
  number: number,
  members: ReadonlySet<string>,
): { rule?: OwnerRule; problems: OwnerProblem[] } {
  const [pattern, ...rest] = wordsOf(line);
  if (pattern === undefined) {
    return { problems: [] };
  }
  const owners = ownersOf(rest);
  const refusal = patternRefusal(pattern) ?? (owners.length === 0 ? "no owners listed." : null);
  if (refusal !== null) {
    return { problems: [{ line: number, message: refusal }] };
  }
  return { rule: { pattern, owners }, problems: problemsOf(number, owners, members) };
}

/** The rules as editable text, one per line. */
export function ownerRulesText(rules: readonly OwnerRule[]): string {
  return rules.map((rule) => `${rule.pattern}  ${rule.owners.join("  ")}`).join("\n");
}

/** Whether `value` is an owner rule as stored: a pattern and a list of owner ids. */
function isOwnerRule(value: unknown): value is OwnerRule {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { pattern, owners } = value as Record<string, unknown>;
  return (
    typeof pattern === "string" &&
    Array.isArray(owners) &&
    owners.every((owner) => typeof owner === "string")
  );
}

/** The stored rules (`projects.component_owners`); anything unreadable is no rules. */
export function readOwnerRules(stored: string | null | undefined): OwnerRule[] {
  if (stored === null || stored === undefined || stored === "") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is OwnerRule => isOwnerRule(item))
      : [];
  } catch {
    return [];
  }
}

/** The rules as stored: JSON, or null for an empty map. */
export function serializeOwnerRules(rules: readonly OwnerRule[]): string | null {
  return rules.length === 0 ? null : JSON.stringify(rules);
}

/**
 * The owners of the given story files, with the files that put each there. A file takes the owners
 * of every rule it matches (the union), so rule order does not matter. Only ids in `memberIds` are
 * kept: a member removed since the rules were saved is not assigned. Owners come back in the order
 * they first appear in the rules.
 */
export function assignOwners(
  rules: readonly OwnerRule[],
  paths: readonly string[],
  memberIds: ReadonlySet<string>,
): AssignedOwner[] {
  const found = new Map<string, Set<string>>();
  for (const rule of rules) {
    const matches = compileOwnerPattern(rule.pattern);
    const matched = paths.filter((path) => matches(path));
    for (const owner of rule.owners.filter((id) => matched.length > 0 && memberIds.has(id))) {
      const files = found.get(owner) ?? new Set<string>();
      for (const path of matched) {
        files.add(path);
      }
      found.set(owner, files);
    }
  }
  return [...found].map(([userId, files]) => ({ userId, paths: [...files].toSorted() }));
}
