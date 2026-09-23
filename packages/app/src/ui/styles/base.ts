/** Base reset, typography, focus ring, and shared utilities. */
export function baseCss(): string {
  return `${resetCss()}\n${utilityCss()}`;
}

function resetCss(): string {
  return `
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; font-size: 14px; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background: var(--surface-base); color: var(--text-primary); line-height: 1.5; -webkit-font-smoothing: antialiased; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: var(--radius-sm); }
    code, kbd, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; }
    kbd { display: inline-block; padding: .1rem .35rem; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: var(--radius-sm); background: var(--surface-muted); color: var(--text-secondary); font-size: .75rem; line-height: 1.2; }
    .skip-link { position: absolute; left: -9999px; top: auto; width: 1px; height: 1px; overflow: hidden; }
    .skip-link:focus { left: 1rem; top: 1rem; width: auto; height: auto; background: var(--surface-card); color: var(--text-primary); padding: .5rem .75rem; border-radius: var(--radius-sm); box-shadow: var(--shadow); z-index: 100; }`;
}

function utilityCss(): string {
  return `
    .row-actions { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
    .split { display: flex; gap: 1rem; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; }
    .min-w-0 { min-width: 0; }
    .max-w-cell { max-width: 32ch; }
    .stack { display: grid; gap: .75rem; }
    .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .muted { color: var(--text-secondary); }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .login { max-width: 360px; margin: 3rem auto; }
    .login button { width: 100%; margin-top: 1rem; }
    .max-w-form { max-width: 880px; }
    .max-w-prose { max-width: 640px; }
    .table-gap { margin-top: .75rem; }
    .mt-1 { margin-top: 1rem; }
    .mb-1 { margin-bottom: 1rem; }
    @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }`;
}
