/** A parsed `x.y.z[-pre]` version. */
interface Version {
  core: [number, number, number];
  pre: string[];
}

const VERSION =
  /^v?(?<major>\d+)(?:\.(?<minor>\d+|x|\*))?(?:\.(?<patch>\d+|x|\*))?(?:-(?<pre>[0-9A-Za-z.-]+))?(?:\+.*)?$/u;

function part(value: string | undefined): number {
  return /^\d+$/u.test(value ?? "") ? Number(value) : 0;
}

function parse(text: string): Version | undefined {
  const found = VERSION.exec(text.trim())?.groups;
  if (found === undefined) return undefined;
  return {
    core: [part(found["major"]), part(found["minor"]), part(found["patch"])],
    pre: found["pre"] === undefined ? [] : found["pre"].split("."),
  };
}

function comparePre(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return right.length - left.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const [one, two] = [left[index], right[index]];
    if (one === undefined || two === undefined) return one === undefined ? -1 : 1;
    const numbers = /^\d+$/u.test(one) && /^\d+$/u.test(two);
    const order = numbers ? Number(one) - Number(two) : one.localeCompare(two);
    if (order !== 0) return Math.sign(order);
  }
  return 0;
}

function compare(left: Version, right: Version): number {
  for (let index = 0; index < 3; index += 1) {
    const order = (left.core[index] ?? 0) - (right.core[index] ?? 0);
    if (order !== 0) return Math.sign(order);
  }
  return comparePre(left.pre, right.pre);
}

/** The exclusive upper bound of `^` and `~` on `base`. */
function upperBound(base: Version, caret: boolean): Version {
  const [major, minor, patch] = base.core;
  if (!caret) return { core: [major, minor + 1, 0], pre: [] };
  if (major > 0) return { core: [major + 1, 0, 0], pre: [] };
  return minor > 0 ? { core: [0, minor + 1, 0], pre: [] } : { core: [0, 0, patch + 1], pre: [] };
}

const COMPARATOR = /^(?<op>\^|~|>=|<=|>|<|=)?\s*(?<rest>\S+)$/u;

function wildcard(text: string): boolean {
  return text === "*" || text === "x" || text === "";
}

function satisfiesComparator(version: Version, text: string): boolean {
  if (wildcard(text)) return true;
  const found = COMPARATOR.exec(text)?.groups;
  const base = parse(found?.["rest"] ?? "");
  if (found === undefined || base === undefined) return false;
  const order = compare(version, base);
  switch (found["op"]) {
    case "^":
    case "~":
      return order >= 0 && compare(version, upperBound(base, found["op"] === "^")) < 0;
    case ">=":
      return order >= 0;
    case ">":
      return order > 0;
    case "<=":
      return order <= 0;
    case "<":
      return order < 0;
    default:
      return order === 0;
  }
}

/**
 * Whether `version` satisfies `range`: exact, `^`, `~`, the four comparison operators, `*`, spaces for
 * AND and `||` for OR. Enough for the peer ranges of the published packages; not a general semver.
 */
export function satisfies(version: string, range: string): boolean {
  const parsed = parse(version);
  if (parsed === undefined) return false;
  return range.split("||").some((alternative) =>
    alternative
      .trim()
      .split(/\s+(?=[\^~<>=]|\d)/u)
      .every((comparator) => satisfiesComparator(parsed, comparator)),
  );
}
