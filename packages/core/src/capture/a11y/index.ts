/**
 * Shared axe-core accessibility checks for capture runners (ADR 0004 §6).
 *
 * Runners inject the axe source into the story page, read `parameters.a11y`, run axe over the story
 * root and map the slim result to `a11y:` annotation strings. Results never block a build.
 */
export { axeInjectionScript, loadAxeSource, resetAxeSourceCache } from "./axe-source.ts";
export { inPageReadA11yParameters, inPageRunAxe } from "./in-page.ts";
export { mapAxeViolations, MAX_REPORTED_VIOLATIONS, type SlimViolation } from "./map.ts";
export { A11Y_ROOT_SELECTOR, resolveA11yRun, type A11yRunPlan } from "./options.ts";
