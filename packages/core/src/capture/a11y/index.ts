/**
 * Accessibility annotation strings shared by the orchestrator and the app (ADR 0004 §6). The
 * checks themselves (injection, in-page axe, mapping) live in `@storyshelf/runner/a11y`.
 */
export {
  axeUnavailableNote,
  axeUnavailableReason,
  baselineNote,
  baselineSha,
  BASELINE_SHA_LENGTH,
  isA11yNote,
  parametersNote,
  parametersReason,
} from "./notes.ts";
