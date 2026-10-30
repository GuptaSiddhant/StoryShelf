/** Named capture modes: parameters → viewports carrying Storybook globals. */
import type { ModeDefinition, ModeMap, ModeViewportValue, Viewport } from "./adapter.ts";

/** Upper bound on captures (global viewports + modes) per story. */
export const MAX_MODES_PER_STORY = 8;

/** Resolves a Storybook viewport name to dimensions (story config, then builtins). */
export type ViewportLookup = (name: string) => Viewport | undefined;

const SLUG_STRIP = /[^a-z0-9]+/gu;
const SLUG_EDGES = /^-+|-+$/gu;
const HEX_COLOR = /^#(?<hex>[0-9a-fA-F]{3,8})$/u;

/**
 * Baseline identity for a mode name: lower-case, URL/path-safe, stable under
 * whitespace/case edits. Throws for names with no usable characters.
 */
export function modeSlug(name: string): string {
  const slug = name.toLowerCase().replaceAll(SLUG_STRIP, "-").replaceAll(SLUG_EDGES, "");
  if (slug === "") {
    throw new Error(`Invalid mode name: ${JSON.stringify(name)}`);
  }
  return slug;
}

/**
 * Apply `modes` on top of a story's base viewports. A mode named like an
 * existing viewport replaces it; `disable: true` drops that entry (inherited
 * mode or viewport). Output order: base viewports first, then new modes.
 */
export function applyModes(
  modes: ModeMap | undefined,
  base: Viewport[],
  lookup: ViewportLookup,
): Viewport[] {
  if (!modes) return [...base];
  const bySlug = new Map<string, Viewport>(
    base.map((viewport) => [modeSlug(viewport.name), viewport]),
  );
  const fallback = base[0] ?? { name: "desktop", width: 1280, height: 720 };
  for (const [name, definition] of Object.entries(modes)) {
    const slug = modeSlug(name);
    if (definition.disable === true) {
      bySlug.delete(slug);
    } else {
      bySlug.set(slug, modeViewport(slug, definition, fallback, lookup));
    }
  }
  return [...bySlug.values()];
}

/** Keep only allow-listed modes; `null`/empty allowlist keeps all. */
export function filterModes(
  modes: ModeMap | undefined,
  allowlist: readonly string[] | null,
): ModeMap | undefined {
  if (!modes || !allowlist || allowlist.length === 0) return modes;
  const allowed = new Set(allowlist.map((name) => modeSlug(name)));
  return Object.fromEntries(
    Object.entries(modes).filter(
      ([name, definition]) => definition.disable === true || allowed.has(modeSlug(name)),
    ),
  );
}

/** Parse the project's JSON `modesAllowlist` column; `null` when unset/invalid. */
export function parseModesAllowlist(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStringArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Encode globals for Storybook's `globals` URL arg (`a:b;c.d:e`). Nested
 * objects flatten to dot paths; booleans/null/undefined/hex colors use the
 * `!`-prefixed forms Storybook parses. Plain strings pass through (Storybook
 * only accepts `[a-zA-Z0-9 _-]` and silently drops anything else).
 */
export function buildGlobalsParam(globals: Record<string, unknown>): string {
  return flatten(globals, "")
    .map(([key, value]) => `${key}:${encodeValue(value)}`)
    .join(";");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function modeViewport(
  slug: string,
  definition: ModeDefinition,
  fallback: Viewport,
  lookup: ViewportLookup,
): Viewport {
  const { viewport, disable: _disable, ...globals } = definition;
  const size = resolveSize(viewport, fallback, lookup);
  return {
    name: slug,
    width: size.width,
    height: size.height,
    ...(Object.keys(globals).length > 0 ? { globals } : {}),
  };
}

function resolveSize(
  value: ModeViewportValue | undefined,
  fallback: Viewport,
  lookup: ViewportLookup,
): { width: number; height: number } {
  if (value === undefined) return fallback;
  if (typeof value === "number") return { width: Math.round(value), height: fallback.height };
  if (typeof value === "string") return lookup(value) ?? fallback;
  return { width: Math.round(value.width), height: Math.round(value.height) };
}

function flatten(value: Record<string, unknown>, prefix: string): [string, unknown][] {
  return Object.entries(value).flatMap(([key, entry]): [string, unknown][] =>
    isPlainObject(entry) ? flatten(entry, `${prefix}${key}.`) : [[`${prefix}${key}`, entry]],
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeValue(value: unknown): string {
  if (value === true) return "!true";
  if (value === false) return "!false";
  if (value === null) return "!null";
  if (value === undefined) return "!undefined";
  const text =
    typeof value === "string" || typeof value === "number"
      ? String(value)
      : (JSON.stringify(value) ?? "");
  const hex = HEX_COLOR.exec(text)?.groups?.["hex"];
  return hex ? `!hex(${hex})` : text;
}
