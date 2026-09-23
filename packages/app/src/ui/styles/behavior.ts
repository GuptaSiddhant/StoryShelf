/** Behavioral CSS: HTMX indicators, skeletons, tables, stats. */
export function behaviorCss(): string {
  return `${htmxCss()}\n${dataCss()}`;
}

function htmxCss(): string {
  return `
    .htmx-indicator { opacity: 0; transition: opacity 150ms ease; }
    .htmx-request .htmx-indicator, .htmx-request.htmx-indicator { opacity: 1; }
    button.htmx-request, form.htmx-request button, [hx-post].htmx-request { pointer-events: none; opacity: .7; }
    form.htmx-request { opacity: .9; }
    .skeleton { position: relative; overflow: hidden; background: var(--surface-muted); border-radius: var(--radius-sm); min-height: 1rem; }
    .skeleton::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent); animation: skeleton 1.4s infinite; }
    [data-theme="dark"] .skeleton::after { background: linear-gradient(90deg, transparent, rgba(255,255,255,.08), transparent); }
    @keyframes skeleton { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
    @media (prefers-reduced-motion: reduce) { .htmx-indicator, .htmx-request { transition: none; } .skeleton::after { animation: none; } }`;
}

function dataCss(): string {
  return `
    .table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-card); }
    table { width: 100%; border-collapse: collapse; font-size: .875rem; }
    th, td { text-align: left; padding: .6rem .75rem; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }
    th { background: var(--surface-subtle); font-weight: 600; color: var(--text-secondary); font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; white-space: nowrap; }
    tbody tr:hover { background: var(--surface-subtle); }
    tr:last-child td { border-bottom: 0; }
    td.nowrap { white-space: nowrap; }
    .grid { display: grid; gap: 1rem; }
    .grid--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .grid--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    @media (max-width: 880px) { .grid--2, .grid--3 { grid-template-columns: 1fr; } }`;
}
