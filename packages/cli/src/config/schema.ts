/** The shape of `.storybook/storyshelf.json`: validation, and the `$schema` reference stamped into new files. */
import { existsSync } from "node:fs";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

declare const __PKG_VERSION__: string | undefined;

/** Validated `.storybook/storyshelf.json` contents. */
export interface StorybookConfig {
  slug: string;
  url?: string;
  buildDir?: string;
  buildCommand?: string;
  buildScriptName?: string;
  skip?: string;
  affectedOnly?: boolean;
  /** Append `--stats-json` to the build script when affected capture is on (default true). */
  buildStats?: boolean;
  /** Record a commit that changed no story as a skipped build instead of uploading (default false). */
  skipUnchanged?: boolean;
  /** Glob patterns excluded from affected tracing (union with `--untraced`). */
  untraced?: string[];
}

/** Parse an unknown value into a `StorybookConfig`, or return the reason it is invalid. */
export function parseStorybookConfig(value: unknown): ParseResult {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "expected an object" };
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const slug = readSlug(record);
  if (!slug.ok) {
    return slug;
  }
  const parts = readConfigParts(record);
  if (!parts.ok) {
    return parts;
  }
  return checkCrossFieldRules(slug.slug, parts);
}

/** Optional string, boolean, and string-list config sections. */
type ConfigParts =
  | {
      ok: true;
      values: Record<string, string>;
      flags: Record<string, boolean>;
      lists: Record<string, string[]>;
    }
  | { ok: false; error: string };

/** Read the optional string, boolean, and string-list config sections. */
function readConfigParts(record: Record<string, unknown>): ConfigParts {
  const optional = readOptionalStrings(record, OPTIONAL_CONFIG_KEYS);
  if (!optional.ok) {
    return optional;
  }
  const flags = readOptionalBooleans(record, BOOLEAN_CONFIG_KEYS);
  if (!flags.ok) {
    return flags;
  }
  const lists = readOptionalStringArrays(record, STRING_ARRAY_CONFIG_KEYS);
  if (!lists.ok) {
    return lists;
  }
  return { ok: true, values: optional.values, flags: flags.values, lists: lists.values };
}

/** Read the required slug field. */
function readSlug(
  record: Record<string, unknown>,
): { ok: true; slug: string } | { ok: false; error: string } {
  const slug = record["slug"];
  if (typeof slug !== "string" || slug.length === 0) {
    return { ok: false, error: "slug is required" };
  }
  return { ok: true, slug };
}

/** Optional config keys with plain string values. */
const OPTIONAL_CONFIG_KEYS = [
  "url",
  "buildDir",
  "buildCommand",
  "buildScriptName",
  "skip",
] as const;

/** Optional config keys with boolean values. */
const BOOLEAN_CONFIG_KEYS = ["affectedOnly", "buildStats", "skipUnchanged"] as const;

/** Optional config keys with string-array values. */
const STRING_ARRAY_CONFIG_KEYS = ["untraced"] as const;

type ParseResult = { ok: true; config: StorybookConfig } | { ok: false; error: string };

/** Read optional non-empty string fields; any present-but-invalid field is an error. */
function readOptionalStrings(
  record: Record<string, unknown>,
  keys: readonly string[],
): { ok: true; values: Record<string, string> } | { ok: false; error: string } {
  const values: Record<string, string> = {};
  for (const key of keys) {
    const raw = record[key];
    if (raw === undefined) {
      continue;
    }
    if (typeof raw !== "string" || raw.length === 0) {
      return { ok: false, error: `${key} must be a non-empty string` };
    }
    values[key] = raw;
  }
  return { ok: true, values };
}

/** Read optional boolean fields; any present-but-invalid field is an error. */
function readOptionalBooleans(
  record: Record<string, unknown>,
  keys: readonly string[],
): { ok: true; values: Record<string, boolean> } | { ok: false; error: string } {
  const values: Record<string, boolean> = {};
  for (const key of keys) {
    const raw = record[key];
    if (raw === undefined) {
      continue;
    }
    if (typeof raw !== "boolean") {
      return { ok: false, error: `${key} must be a boolean` };
    }
    values[key] = raw;
  }
  return { ok: true, values };
}

/** Read optional string-array fields; any present-but-invalid field is an error. */
function readOptionalStringArrays(
  record: Record<string, unknown>,
  keys: readonly string[],
): { ok: true; values: Record<string, string[]> } | { ok: false; error: string } {
  const values: Record<string, string[]> = {};
  for (const key of keys) {
    const raw = record[key];
    if (raw === undefined) {
      continue;
    }
    const collected = collectStringArray(key, raw);
    if (!collected.ok) {
      return collected;
    }
    values[key] = collected.values;
  }
  return { ok: true, values };
}

/** Collect validated string entries, or the reason the list is invalid. */
function collectStringArray(
  key: string,
  raw: unknown,
): { ok: true; values: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: `${key} must be an array of non-empty strings` };
  }
  const values: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length === 0) {
      return { ok: false, error: `${key} must be an array of non-empty strings` };
    }
    values.push(entry);
  }
  return { ok: true, values };
}

/** Enforce url shape and the buildCommand/buildScriptName exclusion. */
function checkCrossFieldRules(
  slug: string,
  parts: {
    values: Record<string, string>;
    flags: Record<string, boolean>;
    lists: Record<string, string[]>;
  },
): ParseResult {
  const url = parts.values["url"];
  if (url !== undefined && !isHttpUrl(url)) {
    return { ok: false, error: "url must be a valid http(s) URL" };
  }
  if (parts.values["buildCommand"] && parts.values["buildScriptName"]) {
    return { ok: false, error: "buildCommand and buildScriptName are mutually exclusive" };
  }
  const { buildDir, buildCommand, buildScriptName, skip } = parts.values;
  const { affectedOnly, buildStats, skipUnchanged } = parts.flags;
  const untraced = parts.lists["untraced"];
  return {
    ok: true,
    config: {
      slug,
      ...(url === undefined ? {} : { url }),
      ...(buildDir === undefined ? {} : { buildDir }),
      ...(buildCommand === undefined ? {} : { buildCommand }),
      ...(buildScriptName === undefined ? {} : { buildScriptName }),
      ...(skip === undefined ? {} : { skip }),
      ...(affectedOnly === undefined ? {} : { affectedOnly }),
      ...(buildStats === undefined ? {} : { buildStats }),
      ...(skipUnchanged === undefined ? {} : { skipUnchanged }),
      ...(untraced === undefined ? {} : { untraced }),
    },
  };
}

/** True for http(s) URLs. */
function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Base URL for version-pinned config schemas published with the CLI. */
const SCHEMA_BASE_URL = "https://unpkg.com/storyshelf";
/** Schema path within the published CLI package. */
const SCHEMA_PACKAGE_PATH = "schema/storyshelf-config.json";

/** Running CLI version, or undefined in dev/test without the build define. */
export function cliVersion(): string | undefined {
  if (typeof __PKG_VERSION__ !== "string") {
    return undefined;
  }
  return __PKG_VERSION__ === "" || __PKG_VERSION__ === "0.0.0" ? undefined : __PKG_VERSION__;
}

/** Options for resolving the `$schema` value stamped into new configs. */
export interface SchemaReferenceOptions {
  /** Module URL to resolve the CLI install from (defaults to this module). */
  moduleUrl?: string;
  /** CLI version override (defaults to the running CLI version). */
  version?: string;
}

/**
 * Resolve the `$schema` value for a config file: a path relative to the
 * config directory when the schema ships alongside this CLI on disk, else a
 * versioned unpkg URL. Never throws — falls back to the unversioned URL.
 *
 * @param configDir - Directory that will contain the config file.
 * @param options - Module URL and version overrides (test seams).
 */
export function schemaReference(configDir: string, options: SchemaReferenceOptions = {}): string {
  // Resolved from where this code lived before it moved into config/ (src/config.ts, dist/config.js),
  // so the bundled schema is still found one level up from the module directory.
  const local = resolveLocalSchema(
    configDir,
    options.moduleUrl ?? new URL("../config.ts", import.meta.url).href,
  );
  if (local !== null) {
    return local;
  }
  const version = options.version ?? cliVersion();
  return version === undefined
    ? `${SCHEMA_BASE_URL}/${SCHEMA_PACKAGE_PATH}`
    : `${SCHEMA_BASE_URL}@${version}/${SCHEMA_PACKAGE_PATH}`;
}

/** Repo-relative path to the bundled schema, or null when not on disk. */
function resolveLocalSchema(configDir: string, moduleUrl: string): string | null {
  let schemaPath: string;
  try {
    schemaPath = fileURLToPath(new URL(`../${SCHEMA_PACKAGE_PATH}`, moduleUrl));
  } catch {
    return null;
  }
  if (!existsSync(schemaPath)) {
    return null;
  }
  const rel = relative(configDir, schemaPath).split(sep).join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}
