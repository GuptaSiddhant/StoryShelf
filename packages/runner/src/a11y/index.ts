/**
 * Accessibility checks for the Playwright runner (`@storyshelf/runner/a11y`, ADR 0004 §6): the axe
 * source and injection script, the functions evaluated inside the story page, `parameters.a11y`
 * resolution and the violation mapper. The annotation strings and their readers stay in core.
 */
export { axeInjectionScript, loadAxeSource } from "./a11y-source.ts";
export { checkA11y } from "./a11y.ts";
export { inPageReadA11yParameters, inPageRunAxe, type A11yParametersRead } from "./in-page.ts";
export { mapAxeViolations, MAX_REPORTED_VIOLATIONS, type SlimViolation } from "./map.ts";
export { A11Y_ROOT_SELECTOR, resolveA11yRun, type A11yRunPlan } from "./options.ts";
