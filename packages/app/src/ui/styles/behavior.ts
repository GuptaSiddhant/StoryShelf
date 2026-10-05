/** Behavioral CSS: HTMX indicators, skeletons, tables, stats. */
export function behaviorCss(): string {
  return `${htmxCss()}\n${dataCss()}\n${chromeCss()}`;
}

function htmxCss(): string {
  return `
    html.ss-loading::before { content: ""; position: fixed; top: 0; left: 0; z-index: 90; height: 2px; width: 100%; background: var(--accent); transform-origin: left; animation: ss-load 1.2s var(--ease) infinite; }
    @keyframes ss-load { 0% { transform: scaleX(0); } 70% { transform: scaleX(0.85); } 100% { transform: scaleX(1); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; } }
    .htmx-indicator { opacity: 0; transition: opacity 150ms ease; }
    .htmx-request .htmx-indicator, .htmx-request.htmx-indicator { opacity: 1; }
    button.htmx-request, form.htmx-request button, [hx-post].htmx-request { pointer-events: none; opacity: .7; }
    form.htmx-request { opacity: .9; }
    form.htmx-request button[type="submit"]::after { content: ""; width: .85em; height: .85em; margin-left: .4rem; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: ss-spin .7s linear infinite; }
    @keyframes ss-spin { to { transform: rotate(360deg); } }
    .skeleton { position: relative; overflow: hidden; background: var(--surface-muted); border-radius: var(--radius-sm); min-height: 1rem; }
    .skeleton::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent); animation: skeleton 1.4s infinite; }
    [data-theme="dark"] .skeleton::after { background: linear-gradient(90deg, transparent, rgba(255,255,255,.08), transparent); }
    @keyframes skeleton { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .htmx-indicator, .htmx-request { transition: none; } .skeleton::after { animation: none; } }`;
}

function dataCss(): string {
  return `
    .grid { display: grid; gap: 1rem; }
    .grid--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .grid--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    @media (max-width: 880px) { .grid--2, .grid--3 { grid-template-columns: 1fr; } }`;
}

/** Truly global chrome rules (depend on ancestors outside any one subtree). */
function chromeCss(): string {
  return `
    @media (min-width: 881px) { html[data-sidebar="rail"] { --sidebar-width: 68px; } }
    [data-theme-icon] { display: none; }
    [data-theme="light"] [data-theme-icon="light"], [data-theme="dark"] [data-theme-icon="dark"], [data-theme="system"] [data-theme-icon="system"] { display: inline-flex; }`;
}
