/**
 * Story-only: show an element in a state the browser only has while the pointer is on it
 * (`:hover`, `:active`). A play function cannot make those real (`userEvent` sends synthetic
 * events, and `:hover` follows the real pointer), so this copies each such rule of the page's
 * stylesheets under an attribute selector (`[data-force-hover]`) and marks the element. Nothing in
 * `src/` changes: the facade keeps its plain `:hover` and `:active` rules.
 */
export type ForcedPseudoState = "hover" | "active";

/** A style rule (not an at-rule): the one kind with a selector and declarations. */
function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  return "selectorText" in rule;
}

/** The stylesheet rules that carry the state, each with the selector of the rule it is nested in. */
function rulesWith(
  state: ForcedPseudoState,
  rules: CSSRuleList,
  parent: string | undefined,
  found: Array<{ selector: string; body: string }>,
): void {
  for (const rule of rules) {
    if (!isStyleRule(rule)) {
      continue;
    }
    const mark = `:${state}`;
    if (rule.selectorText.includes(mark)) {
      const outer = parent ?? "";
      const selector = rule.selectorText
        .split(",")
        .filter((part) => part.includes(mark))
        .map((part) =>
          part
            .trim()
            .replaceAll(`&${mark}`, `${outer}[data-force-${state}]`)
            .replaceAll(mark, `[data-force-${state}]`),
        )
        .join(",");
      found.push({ selector, body: rule.style.cssText });
    }
    rulesWith(state, rule.cssRules, rule.selectorText, found);
  }
}

/** Make the element look as it does while hovered or pressed (once per state and page). */
export function forcePseudoState(element: Element, state: ForcedPseudoState): void {
  const { styleSheets } = element.ownerDocument;
  const found: Array<{ selector: string; body: string }> = [];
  for (const sheet of styleSheets) {
    rulesWith(state, sheet.cssRules, undefined, found);
  }
  const sheet = styleSheets[0];
  for (const { selector, body } of found) {
    sheet?.insertRule(`${selector} { ${body} }`, sheet.cssRules.length);
  }
  element.setAttribute(`data-force-${state}`, "");
}
