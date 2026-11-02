/**
 * Ignore regions: elements a story marks as dynamic (timestamps, avatars, ads) are hidden before
 * the screenshot so they never produce a diff. Both runners inject the stylesheet built here, so
 * the mask is identical across engines. Baseline keys and diff math are untouched.
 */

/** Most selectors one story may declare; the rest are dropped. */
export const MAX_IGNORE_SELECTORS = 50;

/** Selectors that always apply: StoryShelf's attribute, then the Chromatic migration spellings. */
export const DEFAULT_IGNORE_SELECTORS: readonly string[] = [
  "[data-storyshelf-ignore]",
  ".chromatic-ignore",
  '[data-chromatic="ignore"]',
];

/** The declarations applied to a masked element: hidden, but still taking up its space. */
const MASK_DECLARATION = "visibility: hidden !important;";

/** Characters that could close the rule and open another one; such a selector is refused. */
const UNSAFE_SELECTOR = /[{}]|\/\*|<\/?style/iu;

/** Whether `selector` is non-empty text that cannot break out of a single CSS rule. */
export function isSafeIgnoreSelector(selector: unknown): selector is string {
  return typeof selector === "string" && selector.trim() !== "" && !UNSAFE_SELECTOR.test(selector);
}

/** The result of reading a story's `ignoreSelectors`. */
export interface IgnoreSelectorList {
  /** Trimmed, deduplicated, safe selectors, at most {@link MAX_IGNORE_SELECTORS}. */
  selectors: string[];
  /** Entries that were refused (not a string, empty, or unsafe) or cut by the cap. */
  skipped: string[];
}

/** Clean the declared `ignoreSelectors` value; anything that is not an array yields no selectors. */
export function cleanIgnoreSelectors(value: unknown): IgnoreSelectorList {
  const result: IgnoreSelectorList = { selectors: [], skipped: [] };
  if (!Array.isArray(value)) return result;
  for (const entry of value as unknown[]) {
    if (!isSafeIgnoreSelector(entry)) {
      result.skipped.push(typeof entry === "string" ? entry : String(entry));
    } else if (result.selectors.length >= MAX_IGNORE_SELECTORS) {
      result.skipped.push(entry);
    } else if (!result.selectors.includes(entry.trim())) {
      result.selectors.push(entry.trim());
    }
  }
  return result;
}

/**
 * The string entries of a declared `ignoreSelectors` value, untouched, or `undefined` when there
 * are none. Safety and the cap are applied later by {@link cleanIgnoreSelectors}, in the runner,
 * so a refused selector can still be reported on the snapshot log.
 */
export function declaredIgnoreSelectors(value: unknown): string[] | undefined {
  const strings = Array.isArray(value)
    ? (value as unknown[]).filter((entry): entry is string => typeof entry === "string")
    : [];
  return strings.length > 0 ? strings : undefined;
}

/**
 * The stylesheet that masks `selectors` plus {@link DEFAULT_IGNORE_SELECTORS}. Each selector gets
 * its own pair of rules, so a selector the browser rejects cannot take the others down with it:
 * the element itself, and (`:is()` forgives an invalid selector) every descendant, so a child that
 * sets `visibility: visible` is hidden too. Unsafe selectors are dropped here as well.
 */
export function ignoreStylesheet(selectors: readonly string[] = []): string {
  const all = [...new Set([...DEFAULT_IGNORE_SELECTORS, ...selectors])].filter((selector) =>
    isSafeIgnoreSelector(selector),
  );
  return all
    .map(
      (selector) =>
        `${selector} { ${MASK_DECLARATION} }\n:is(${selector}) * { ${MASK_DECLARATION} }`,
    )
    .join("\n");
}
