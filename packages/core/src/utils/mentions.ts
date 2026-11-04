/**
 * `@handle` mentions in review comments (#463). A handle is a project member's email local part or
 * display name, matched case-insensitively and only against the candidates the caller passes (the
 * project's members), so a mention never reveals who belongs to another project. Pure: the caller
 * loads the members and stores the result.
 */

/** A member a comment can mention: their id and the handles that name them. */
export interface MentionCandidate {
  userId: string;
  /** Email local part and display name; blank entries are ignored. */
  handles: readonly string[];
}

/** A mention found in a body: the member, and the handle text as typed (after the `@`). */
export interface FoundMention {
  userId: string;
  handle: string;
}

/** Where a mention sits in a body: `start` is the `@`, `end` is just past the handle. */
export interface MentionSpan {
  userId: string;
  start: number;
  end: number;
}

const WORD = /[\p{L}\p{N}_]/u;
const INNER = /[.-]/u;

/** Whether `@` at `index` starts a mention rather than sitting inside a word, as in `a@b.com`. */
function startsMention(body: string, index: number): boolean {
  return body[index] === "@" && (index === 0 || !WORD.test(body[index - 1] ?? ""));
}

/**
 * Whether the handle ends at `end`: the body ends, or the next character is not part of a longer
 * word. A `.` or `-` followed by a word character continues the handle (`@alex.doe.smith`), but a
 * sentence-ending `.` does not.
 */
function endsMention(body: string, end: number): boolean {
  const next = body[end];
  if (next === undefined) {
    return true;
  }
  if (WORD.test(next)) {
    return false;
  }
  return !(INNER.test(next) && WORD.test(body[end + 1] ?? ""));
}

/** The text after the `@` at `index` if it is exactly `handle` (case-insensitive), else undefined. */
function handleAt(body: string, index: number, handle: string): string | undefined {
  const end = index + 1 + handle.length;
  const typed = body.slice(index + 1, end);
  return typed.toLowerCase() === handle && endsMention(body, end) ? typed : undefined;
}

/** Lower-cased handle -> every member it names. */
function ownersOf(candidates: readonly MentionCandidate[]): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    for (const raw of candidate.handles) {
      const handle = raw.trim().toLowerCase();
      if (handle !== "") {
        owners.set(handle, (owners.get(handle) ?? new Set()).add(candidate.userId));
      }
    }
  }
  return owners;
}

/**
 * Lower-cased handle -> the one member it names, or `undefined` when several members share it. A
 * shared handle stays listed as a blocker so a longer shared handle (`@Alex Smith`) never falls
 * back to a shorter unique one (`@Alex`) at the same `@`.
 */
function listedHandles(candidates: readonly MentionCandidate[]): Map<string, string | undefined> {
  const listed = new Map<string, string | undefined>();
  for (const [handle, ids] of ownersOf(candidates)) {
    const [only] = ids;
    listed.set(handle, ids.size === 1 ? only : undefined);
  }
  return listed;
}

/**
 * The first handle (longest first, so `@alex.doe` beats `@alex`) that matches at `index`. A shared
 * handle matches as a blocker and yields no mention at that `@`.
 */
function matchAt(
  body: string,
  index: number,
  handles: readonly [string, string | undefined][],
): { userId: string; typed: string } | undefined {
  for (const [handle, userId] of handles) {
    const typed = handleAt(body, index, handle);
    if (typed !== undefined) {
      return userId === undefined ? undefined : { userId, typed };
    }
  }
  return undefined;
}

/** Every mention of a listed handle in `body`, in order, one entry per occurrence. */
function scan(
  body: string,
  handles: readonly [string, string | undefined][],
): (MentionSpan & FoundMention)[] {
  const found: (MentionSpan & FoundMention)[] = [];
  let index = body.indexOf("@");
  while (index !== -1) {
    const match = startsMention(body, index) ? matchAt(body, index, handles) : undefined;
    if (match === undefined) {
      index = body.indexOf("@", index + 1);
    } else {
      const end = index + 1 + match.typed.length;
      found.push({ userId: match.userId, handle: match.typed, start: index, end });
      index = body.indexOf("@", end);
    }
  }
  return found;
}

/**
 * The members `body` mentions, one entry per member (the first mention wins). A handle that no
 * member has, or that two members share (two `Sam`s, or `alex@a.com` and `alex@b.com`), is plain
 * text: guessing would notify the wrong person.
 */
export function resolveMentions(
  body: string,
  candidates: readonly MentionCandidate[],
): FoundMention[] {
  const handles = [...listedHandles(candidates)].toSorted((a, b) => b[0].length - a[0].length);
  const seen = new Set<string>();
  const out: FoundMention[] = [];
  for (const mention of scan(body, handles)) {
    if (!seen.has(mention.userId)) {
      seen.add(mention.userId);
      out.push({ userId: mention.userId, handle: mention.handle });
    }
  }
  return out;
}

/**
 * Where the stored mentions of a comment sit in its body, for highlighting. Only the stored
 * members and handles count, so text that was plain when the comment was posted stays plain.
 */
export function mentionSpans(body: string, mentions: readonly FoundMention[]): MentionSpan[] {
  const handles = mentions
    .map((mention): [string, string] => [mention.handle.toLowerCase(), mention.userId])
    .toSorted((a, b) => b[0].length - a[0].length);
  return scan(body, handles).map(({ userId, start, end }) => ({ userId, start, end }));
}
