import { bootScript } from "../src/shell/boot-script.ts";
import { clientScript } from "../src/shell/client-script.ts";

/**
 * Story-only: run the shell's own boot and client scripts for one story, so the comparison
 * controls (mode, zoom, swipe, flip) work. They are NOT loaded globally in the preview: a story
 * opts in with `interactive: true`, and every other story stays a fixed, capturable state.
 *
 * The client script is built to run more than once: its `document` listeners bind a single time
 * (it returns early when `window.__ssInit` exists) and the per-render wiring, which marks a stage
 * `data-ready`, runs again for each new stage. So loading it for story after story neither stacks
 * listeners nor re-binds a stage that is already wired.
 */
const STORED_CHOICES = ["ss_compare_mode", "ss_compare_zoom"];

/** The script restores the last mode and zoom from `localStorage`; an interactive story starts fresh. */
export function forgetStoredChoices(): void {
  try {
    for (const key of STORED_CHOICES) {
      globalThis.localStorage.removeItem(key);
    }
  } catch {
    /* storage can be unavailable (a private window): nothing to forget */
  }
}

/** Run a classic script from a string, the way the document's inline scripts run. */
function run(source: string): void {
  const { document } = globalThis;
  const script = document.createElement("script");
  script.textContent = source;
  document.head.append(script);
  script.remove();
}

/** Wire the comparison stages under `root` (a story's canvas). Safe to call again for the same canvas. */
export function loadReviewClient(root: ParentNode): void {
  if (root.querySelector("[data-compare][data-ready]")) {
    return;
  }
  forgetStoredChoices();
  const { documentElement } = globalThis.document;
  const theme = documentElement.dataset["theme"];
  run(bootScript());
  // The boot script applies the theme saved in a cookie; the story keeps the toolbar's choice.
  if (theme) {
    documentElement.dataset["theme"] = theme;
  }
  run(clientScript());
}
