/** Turn Storybook's `parameters.a11y` into an axe run plan. */

/** The story root axe scans unless `parameters.a11y.element`/`context` says otherwise. */
export const A11Y_ROOT_SELECTOR = "#storybook-root";

/**
 * Rule tags scanned by default: WCAG A/AA plus axe's `best-practice` rules; `parameters.a11y.options.runOnly`
 * replaces them. The page-level best-practice rules (`region`, `landmark-one-main`,
 * `page-has-heading-one`) need the whole document in scope and so stay silent for the default
 * scan of `#storybook-root`; no rule is switched off by default (checked in a real browser).
 */
const DEFAULT_RUN_ONLY = {
  type: "tag",
  values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
};

/** What to hand to `axe.configure` / `axe.run` in the page (JSON-serialisable). */
export interface A11yRunPlan {
  /** Why the story is skipped (`disable`, `test: "off"`); undefined when axe should run. */
  skip?: string;
  config: Record<string, unknown>;
  options: Record<string, unknown>;
  context: unknown;
}

/**
 * Resolve the run plan from the JSON-serialisable subset of `parameters.a11y` (functions cannot be
 * read from the page). `disable: true` and `test: "off"` skip the story; `test: "todo" | "error"`
 * still only annotate, results never fail a build.
 */
export function resolveA11yRun(raw: unknown): A11yRunPlan {
  const params = asRecord(raw) ?? {};
  const skip = skipReason(params);
  const config = asRecord(params["config"]) ?? {};
  const userOptions = asRecord(params["options"]);
  const rules = { ...disabledByConfig(config), ...asRecord(userOptions?.["rules"]) };
  const options = { runOnly: DEFAULT_RUN_ONLY, ...userOptions, rules };
  const context = params["element"] ?? params["context"] ?? A11Y_ROOT_SELECTOR;
  return { ...(skip ? { skip } : {}), config, options, context };
}

/**
 * `axe.configure({ rules: [{ id, enabled: false }] })` is ignored under a tag-based `runOnly`, so
 * mirror those switches into the run options where they are honoured.
 */
function disabledByConfig(config: Record<string, unknown>): Record<string, { enabled: false }> {
  const out: Record<string, { enabled: false }> = {};
  const rules = Array.isArray(config["rules"]) ? (config["rules"] as unknown[]) : [];
  for (const rule of rules) {
    const entry = asRecord(rule);
    if (entry?.["enabled"] === false && typeof entry["id"] === "string")
      out[entry["id"]] = { enabled: false };
  }
  return out;
}

function skipReason(params: Record<string, unknown>): string | undefined {
  if (params["disable"] === true) return "parameters.a11y.disable";
  if (params["test"] === "off") return 'parameters.a11y.test is "off"';
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
