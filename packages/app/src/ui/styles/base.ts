/** Base reset, typography, focus ring, and shared utilities. */
export function baseCss(): string {
  return `${resetCss()}\n${utilityCss()}`;
}

function resetCss(): string {
  return `
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    /* A sticky review bar must not cover the focused element (WCAG 2.2 focus not obscured). */
    html:has([data-action-bar]) { scroll-padding-bottom: 7rem; }
    main:has([data-action-bar]) { padding-bottom: calc(var(--space-8) * 3.5); }
    body { margin: 0; font-size: var(--text-base); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background: var(--surface-base); color: var(--text-primary); line-height: 1.5; -webkit-font-smoothing: antialiased; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
    code, kbd, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: var(--text-xs); }
    kbd { display: inline-block; padding: 0 var(--space-1); border: 1px solid var(--border); border-bottom-width: 2px; border-radius: var(--radius-sm); background: var(--surface-muted); color: var(--text-secondary); font-size: var(--text-xs); line-height: 1.2; }
    [hidden] { display: none !important; }
    .skip-link { position: absolute; left: -9999px; top: auto; width: 1px; height: 1px; overflow: hidden; }
    .skip-link:focus { left: 1rem; top: 1rem; width: auto; height: auto; background: var(--surface-card); color: var(--text-primary); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); box-shadow: var(--shadow); z-index: 100; }`;
}

function utilityCss(): string {
  return `
    .visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    .min-w-0 { min-width: 0; }
    .max-w-cell { max-width: 32ch; }
    .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .muted { color: var(--text-secondary); }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .max-w-form { max-width: 880px; }
    .max-w-prose { max-width: 640px; }
    .table-gap { margin-top: var(--space-3); }
    .mt-1 { margin-top: var(--space-4); }
    .mb-1 { margin-bottom: var(--space-4); }
    @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }`;
}
