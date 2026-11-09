/**
 * The shape of one changelog entry (ADR 0043, amendment 2026-11-09 "short release notes"): a
 * changeset body starts with `<Kind>: <summary>` alone on its first line, at most
 * {@link SUMMARY_MAX} characters, then the details. `CHANGELOG.md` groups entries by kind with
 * their details; the GitHub Release keeps only the summaries and counts the internal ones.
 *
 * Changesets written before the rule are read leniently: a known lead (`Fixed:`, `**Added: …**`,
 * `Security hardening:` …) gives the kind, else `Changed`, and the first sentence is the summary.
 */

/** Entry kinds, in the order the changelog and the release notes show them. */
export const KINDS = ["Breaking", "Added", "Changed", "Fixed", "Security", "Internal"];

/** The longest summary line, in characters (the kind prefix not counted). */
export const SUMMARY_MAX = 100;

const SUMMARY_LINE = new RegExp(`^(?<kind>${KINDS.join("|")}): (?<summary>\\S.*)$`, "u");

/** Leads used before the rule, mapped to a kind. */
const LEGACY_LEADS = [
  [/^(?:breaking|api change)s?\b/iu, "Breaking"],
  [/^(?:added|add|new)\b/iu, "Added"],
  [/^(?:fixed|fix|fixes)\b/iu, "Fixed"],
  [/^security\b/iu, "Security"],
  [/^(?:changed|change)\b/iu, "Changed"],
];

/**
 * Read a changeset body as an entry.
 *
 * @param {string} body The body below the front matter.
 * @returns {{ kind: string, summary: string, details: string }} Kind, one-line summary, the rest.
 */
export function readEntry(body) {
  const text = body.trim();
  const [first = "", ...rest] = text.split(/\n{2,}/u);
  const match = SUMMARY_LINE.exec(first);
  if (match?.groups && !first.includes("\n")) {
    return { kind: match.groups.kind, summary: match.groups.summary, details: rest.join("\n\n") };
  }
  return readLegacy(text);
}

/** An entry written before the rule: kind from its lead, summary from its first sentence. */
function readLegacy(text) {
  const plain = text.replace(/^\*\*(?<lead>[^*]+)\*\*/u, "$<lead>");
  const lead = LEGACY_LEADS.find(([pattern]) => pattern.test(plain));
  const unprefixed = lead ? plain.replace(/^[^:]{1,40}:\s*/u, "") : plain;
  const [first = "", ...rest] = unprefixed.split(/\n{2,}/u);
  const flat = first.replaceAll(/\s*\n\s*/gu, " ");
  const summary = firstSentence(flat);
  const remainder = flat.slice(summary.length).trim();
  return {
    kind: lead?.[1] ?? "Changed",
    summary,
    details: [remainder, ...rest].filter(Boolean).join("\n\n"),
  };
}

/** The text up to the first full stop outside backticks that ends a sentence. */
function firstSentence(text) {
  let code = false;
  for (let at = 0; at < text.length; at += 1) {
    code = text[at] === "`" ? !code : code;
    if (!code && text[at] === "." && endsSentence(text, at)) {
      return text.slice(0, at + 1);
    }
  }
  return text;
}

function endsSentence(text, at) {
  if (at === text.length - 1) {
    return true;
  }
  const head = text.slice(0, at + 1);
  return (
    text[at + 1] === " " &&
    /[A-Z(*`]/u.test(text[at + 2] ?? "") &&
    !/\b(?:e\.g|i\.e|etc)\.$/u.test(head)
  );
}

/**
 * Why a changeset body does not follow the rule; empty when it does.
 *
 * @param {string} body The body below the front matter.
 * @returns {string[]} One message per problem.
 */
export function entryProblems(body) {
  const first = body.trim().split(/\n{2,}/u)[0] ?? "";
  const match = SUMMARY_LINE.exec(first);
  if (!match?.groups || first.includes("\n")) {
    return [
      `start with one line "<Kind>: <summary>" and a blank line after it (Kind: ${KINDS.join(", ")})`,
    ];
  }
  const { length } = match.groups.summary;
  return length > SUMMARY_MAX
    ? [`the summary is ${length} characters; keep it to ${SUMMARY_MAX} and move the rest below it`]
    : [];
}

/**
 * Changelog markdown for some changeset bodies: one `### <Kind>` block per kind, each entry a bullet
 * with its summary and, indented under it, its details.
 *
 * @param {string[]} bodies Changeset bodies, already in release order.
 * @returns {string[]} One block per kind that has entries, in {@link KINDS} order.
 */
export function renderGrouped(bodies) {
  const entries = bodies.map((body) => readEntry(body));
  return KINDS.map((kind) => entries.filter((entry) => entry.kind === kind))
    .filter((group) => group.length > 0)
    .map((group) => `### ${group[0].kind}\n\n${list(group)}`);
}

/** A list of entries: tight when no entry has details, else one blank line between them. */
function list(group) {
  const loose = group.some((entry) => entry.details !== "");
  return group.map((entry) => bullet(entry)).join(loose ? "\n\n" : "\n");
}

function bullet({ summary, details }) {
  const head = `- ${summary.charAt(0).toUpperCase()}${summary.slice(1)}`;
  if (details === "") {
    return head;
  }
  const indented = details
    .split("\n")
    .map((line) => (line === "" ? "" : `  ${line}`))
    .join("\n");
  return `${head}\n\n${indented}`;
}

/**
 * The short form of a changelog section for a GitHub Release: each kind's summaries without their
 * details, and the internal entries counted instead of listed. A section written before kinds
 * existed (no `### ` heading) comes back unchanged.
 *
 * @param {string} section The section's text below its `## ` heading.
 * @returns {string} The release notes body.
 */
export function shortNotes(section) {
  if (!/^### /mu.test(section)) {
    return section.trim();
  }
  const blocks = section.split(/^(?=### )/mu).map((block) => block.trim());
  const lead = blocks[0]?.startsWith("### ") ? [] : [blocks.shift()];
  const internal = blocks.find((block) => block.startsWith("### Internal"));
  const shown = blocks.filter((block) => block !== internal).map((block) => summariesOf(block));
  const count = internal === undefined ? 0 : bulletsOf(internal).length;
  const note = count === 0 ? [] : [`Plus ${count} internal change${count === 1 ? "" : "s"}.`];
  return [...lead, ...shown, ...note].filter(Boolean).join("\n\n");
}

/** The top-level bullets of a `### Kind` block. */
function bulletsOf(block) {
  return block.split("\n").filter((line) => line.startsWith("- "));
}

/** A `### Kind` block with only its heading and its top-level bullets. */
function summariesOf(block) {
  return `${block.split("\n")[0]}\n\n${bulletsOf(block).join("\n")}`;
}
