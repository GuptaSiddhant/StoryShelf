import type { BrandTheme } from "./theme.ts";

/** Build the global CSS stylesheet from the light and dark brand themes. */
export function baseStyle(light: BrandTheme, dark: BrandTheme): string {
  return `
    :root {
      --accent: ${light.accent};
      --accent-contrast: #fff;
      --surface-base: ${light.surface.base};
      --surface-card: ${light.surface.card};
      --surface-muted: #f4f4f5;
      --text-primary: ${light.text.primary};
      --text-secondary: ${light.text.secondary};
      --border: ${light.border};
      --radius: 10px;
      --radius-sm: 6px;
      --shadow: 0 1px 2px rgba(0,0,0,.06), 0 4px 12px rgba(0,0,0,.04);
      --status-approved: ${light.status.approved};
      --status-new: ${light.status.new};
      --status-rejected: ${light.status.rejected};
      --topbar-bg: ${light.accent};
      --sidebar-bg: #ffffff;
      --sidebar-width: 240px;
    }
    [data-theme="dark"] {
      --accent: ${dark.accent};
      --surface-base: ${dark.surface.base};
      --surface-card: ${dark.surface.card};
      --surface-muted: #1e1e22;
      --text-primary: ${dark.text.primary};
      --text-secondary: ${dark.text.secondary};
      --border: ${dark.border};
      --status-approved: ${dark.status.approved};
      --status-new: ${dark.status.new};
      --status-rejected: ${dark.status.rejected};
      --topbar-bg: #0f172a;
      --sidebar-bg: #111113;
    }
    @media (prefers-color-scheme: dark) {
      [data-theme="system"] {
        --accent: ${dark.accent};
        --surface-base: ${dark.surface.base};
        --surface-card: ${dark.surface.card};
        --surface-muted: #1e1e22;
        --text-primary: ${dark.text.primary};
        --text-secondary: ${dark.text.secondary};
        --border: ${dark.border};
        --status-approved: ${dark.status.approved};
        --status-new: ${dark.status.new};
        --status-rejected: ${dark.status.rejected};
        --topbar-bg: #0f172a;
        --sidebar-bg: #111113;
      }
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; font-family: ui-sans-system, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background: var(--surface-base); color: var(--text-primary); line-height: 1.5; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .skip-link { position: absolute; left: -9999px; top: auto; width: 1px; height: 1px; overflow: hidden; }
    .skip-link:focus { left: 1rem; top: 1rem; width: auto; height: auto; background: var(--surface-card); color: var(--text-primary); padding: .5rem .75rem; border-radius: var(--radius-sm); box-shadow: var(--shadow); z-index: 100; }
    .topbar { position: sticky; top: 0; z-index: 40; background: var(--topbar-bg); color: #fff; border-bottom: 1px solid rgba(255,255,255,.12); }
    .topbar__inner { max-width: 1440px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .6rem 1rem; }
    .topbar__left, .topbar__right { display: flex; align-items: center; gap: .75rem; min-width: 0; }
    .topbar__menu { display: none; background: transparent; border: 1px solid rgba(255,255,255,.3); color: #fff; border-radius: 6px; padding: .35rem .5rem; cursor: pointer; }
    .brand { display: inline-flex; align-items: center; gap: .5rem; color: #fff; font-weight: 650; text-decoration: none; }
    .brand__mark { width: 28px; height: 28px; display: inline-grid; place-items: center; background: rgba(255,255,255,.18); border-radius: 8px; }
    .logo { border-radius: 6px; display: block; }
    .project-crumb { display: inline-flex; align-items: center; gap: .35rem; color: rgba(255,255,255,.9); }
    .project-crumb a { color: #fff; text-decoration: underline; text-underline-offset: 3px; }
    .project-crumb__sep { opacity: .7; }
    .topbar__theme { background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.22); color: #fff; border-radius: 999px; padding: .35rem .6rem; cursor: pointer; display: inline-flex; gap: .25rem; }
    .topbar__theme [data-theme-icon] { display: none; }
    [data-theme="light"] [data-theme-icon="light"], [data-theme="dark"] [data-theme-icon="dark"], [data-theme="system"] [data-theme-icon="system"] { display: inline; }
    .topbar__login { background: #fff; color: var(--accent); padding: .4rem .75rem; border-radius: 999px; font-weight: 600; text-decoration: none; }
    .user-menu { display: inline-flex; align-items: center; gap: .5rem; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.2); padding: .25rem .5rem .25rem .35rem; border-radius: 999px; }
    .user-menu__avatar { width: 28px; height: 28px; border-radius: 999px; object-fit: cover; background: rgba(255,255,255,.2); }
    .user-menu__avatar--fallback { display: inline-grid; place-items: center; font-weight: 700; color: #fff; }
    .user-menu__name { color: #fff; font-weight: 600; max-width: 12ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .user-menu__role { font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; background: rgba(255,255,255,.2); color: #fff; padding: .15rem .4rem; border-radius: 999px; }
    .user-menu__logout { color: #fff; font-size: .85rem; text-decoration: underline; text-underline-offset: 2px; margin-left: .25rem; }
    .shell { max-width: 1440px; margin: 0 auto; display: grid; grid-template-columns: var(--sidebar-width) 1fr; min-height: calc(100vh - 56px); }
    .sidebar { background: var(--sidebar-bg); border-right: 1px solid var(--border); padding: 1rem .75rem; position: sticky; top: 56px; height: calc(100vh - 56px); overflow: auto; }
    .sidebar__nav { display: flex; flex-direction: column; gap: .25rem; }
    .sidebar__section { margin: 1rem 0 .35rem; font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; color: var(--text-secondary); padding: 0 .5rem; }
    .sidebar__link { display: flex; align-items: center; gap: .5rem; padding: .5rem .6rem; border-radius: 8px; color: var(--text-primary); text-decoration: none; }
    .sidebar__link:hover { background: var(--surface-muted); text-decoration: none; }
    .sidebar__link--active { background: var(--surface-muted); font-weight: 600; }
    .content { padding: 1.25rem 1.5rem 2rem; min-width: 0; max-width: 1100px; }
    .page-header { margin-bottom: 1.25rem; }
    .page-header__row { display: flex; gap: 1rem; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
    .page-header__title { margin: 0; font-size: 1.6rem; line-height: 1.2; letter-spacing: -0.02em; }
    .page-header__desc { margin: .35rem 0 0; color: var(--text-secondary); max-width: 60ch; }
    .page-header__actions { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
    .breadcrumbs ol { list-style: none; padding: 0; margin: 0 0 .5rem; display: flex; gap: .4rem; flex-wrap: wrap; color: var(--text-secondary); font-size: .85rem; }
    .breadcrumbs li + li::before { content: "/"; margin-right: .4rem; color: var(--text-secondary); }
    .card { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); }
    .card--padded { padding: 1rem; }
    .btn { appearance: none; border: 1px solid transparent; border-radius: 8px; padding: .55rem .85rem; font-weight: 600; font-size: .9rem; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: .4rem; line-height: 1; }
    .btn--primary { background: var(--accent); color: var(--accent-contrast); border-color: var(--accent); }
    .btn--primary:hover { filter: brightness(1.05); text-decoration: none; }
    .btn--secondary { background: var(--surface-card); color: var(--text-primary); border-color: var(--border); }
    .btn--ghost { background: transparent; color: var(--text-primary); border-color: transparent; }
    .btn--danger { background: var(--status-rejected); color: #fff; border-color: var(--status-rejected); }
    .btn:disabled { opacity: .6; cursor: not-allowed; }
    .badge { display: inline-flex; align-items: center; padding: .15rem .5rem; border-radius: 999px; font-size: .75rem; font-weight: 650; letter-spacing: .02em; border: 1px solid var(--border); background: var(--surface-muted); color: var(--text-secondary); }
    .badge--success { background: color-mix(in srgb, var(--status-approved) 14%, var(--surface-card)); color: var(--status-approved); border-color: color-mix(in srgb, var(--status-approved) 30%, var(--border)); }
    .badge--warning { background: color-mix(in srgb, var(--status-new) 14%, var(--surface-card)); color: var(--status-new); border-color: color-mix(in srgb, var(--status-new) 30%, var(--border)); }
    .badge--danger { background: color-mix(in srgb, var(--status-rejected) 14%, var(--surface-card)); color: var(--status-rejected); border-color: color-mix(in srgb, var(--status-rejected) 30%, var(--border)); }
    .badge--info { background: color-mix(in srgb, var(--accent) 10%, var(--surface-card)); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 25%, var(--border)); }
    .badge--neutral { background: var(--surface-muted); color: var(--text-secondary); }
    .field { display: grid; gap: .35rem; margin-bottom: .9rem; }
    .field__label { font-weight: 600; font-size: .9rem; }
    .field__input { width: 100%; padding: .6rem .7rem; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-card); color: var(--text-primary); font: inherit; }
    .field__input:focus { outline: 2px solid var(--accent); outline-offset: 0; border-color: var(--accent); }
    .field__input--error { border-color: var(--status-rejected); }
    .field__input--textarea { resize: vertical; }
    .field__hint { margin: 0; color: var(--text-secondary); font-size: .85rem; }
    .field__error { margin: 0; color: var(--status-rejected); font-size: .85rem; }
    .alert { border-radius: 8px; padding: .75rem .85rem; border: 1px solid var(--border); background: var(--surface-card); }
    .alert--info { border-color: color-mix(in srgb, var(--accent) 22%, var(--border)); background: color-mix(in srgb, var(--accent) 7%, var(--surface-card)); }
    .alert--success { border-color: color-mix(in srgb, var(--status-approved) 22%, var(--border)); background: color-mix(in srgb, var(--status-approved) 7%, var(--surface-card)); }
    .alert--warning { border-color: color-mix(in srgb, var(--status-new) 22%, var(--border)); background: color-mix(in srgb, var(--status-new) 7%, var(--surface-card)); }
    .alert--danger { border-color: color-mix(in srgb, var(--status-rejected) 22%, var(--border)); background: color-mix(in srgb, var(--status-rejected) 7%, var(--surface-card)); }
    .alert__title { display: block; margin-bottom: .2rem; }
    .tabs { display: flex; gap: .25rem; border-bottom: 1px solid var(--border); margin-bottom: 1rem; overflow-x: auto; }
    .tabs__link { padding: .6rem .75rem; border-bottom: 2px solid transparent; color: var(--text-secondary); text-decoration: none; white-space: nowrap; font-weight: 600; }
    .tabs__link:hover { color: var(--text-primary); text-decoration: none; }
    .tabs__link--active { color: var(--text-primary); border-bottom-color: var(--accent); }
    .empty { text-align: center; padding: 2rem 1rem; border: 1px dashed var(--border); border-radius: var(--radius); background: var(--surface-card); }
    .empty__title { margin: 0 0 .3rem; font-size: 1.1rem; }
    .empty__desc { margin: 0 auto; color: var(--text-secondary); max-width: 50ch; }
    .empty__action { margin-top: 1rem; }
    .grid { display: grid; gap: 1rem; }
    .grid--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .grid--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    @media (max-width: 880px) { .grid--2, .grid--3 { grid-template-columns: 1fr; } }
    .table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-card); }
    table { width: 100%; border-collapse: collapse; font-size: .9rem; }
    th, td { text-align: left; padding: .65rem .75rem; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { background: var(--surface-muted); font-weight: 650; color: var(--text-secondary); font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; }
    tr:last-child td { border-bottom: 0; }
    .stat { text-align: center; padding: .5rem; }
    .stat__value { font-size: 1.4rem; font-weight: 750; line-height: 1; }
    .stat__label { color: var(--text-secondary); font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; }
    .snapshot-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
    .snapshot-card { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--surface-card); display: flex; flex-direction: column; }
    .snapshot-card__head { padding: .6rem .75rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; gap: .5rem; align-items: center; }
    .snapshot-card__meta { font-size: .8rem; color: var(--text-secondary); }
    .snapshot-card__body { padding: .5rem; display: grid; gap: .5rem; }
    .diff-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; }
    @media (max-width: 900px) { .diff-grid { grid-template-columns: 1fr; } }
    .diff-pane { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: var(--surface-card); }
    .diff-pane__label { padding: .4rem .6rem; font-weight: 650; font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; color: var(--text-secondary); background: var(--surface-muted); border-bottom: 1px solid var(--border); }
    .diff-pane__img { display: block; width: 100%; height: auto; background: repeating-conic-gradient(#e5e7eb 0% 25%, #f9fafb 0% 50%) 0 0 / 16px 16px; }
    .comment { border: 1px solid var(--border); border-radius: var(--radius); padding: .75rem; background: var(--surface-card); }
    .comment__head { display: flex; gap: .5rem; align-items: center; font-size: .85rem; color: var(--text-secondary); }
    .comment__body { margin: .5rem 0 0; white-space: pre-wrap; word-break: break-word; }
    @media (max-width: 880px) {
      .topbar__menu { display: inline-flex; }
      .shell { grid-template-columns: 1fr; }
      .sidebar { display: none; position: fixed; inset: 56px 0 0 0; z-index: 30; height: auto; }
      .sidebar--open { display: block; }
      .content { padding: 1rem; }
    }
  `;
}
