/** App chrome: slim branded topbar, neutral sidebar, content area. */
export function shellCss(): string {
  return `${topbarCss()}\n${sidebarCss()}\n${contentCss()}`;
}

function topbarCss(): string {
  return `
    .topbar { position: sticky; top: 0; z-index: 40; background: var(--topbar-bg); color: #fff; border-bottom: 1px solid rgba(255,255,255,.12); }
    .topbar__inner { max-width: 1440px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .5rem 1rem; }
    .topbar__left, .topbar__right { display: flex; align-items: center; gap: .625rem; min-width: 0; }
    .topbar__menu { display: none; background: transparent; border: 1px solid rgba(255,255,255,.3); color: #fff; border-radius: var(--radius-sm); padding: .5rem .75rem; cursor: pointer; min-height: 44px; min-width: 44px; align-items: center; justify-content: center; }
    .brand { display: inline-flex; align-items: center; gap: .5rem; color: #fff; font-weight: 650; font-size: .95rem; text-decoration: none; }
    .brand__mark { width: 26px; height: 26px; display: inline-grid; place-items: center; background: rgba(255,255,255,.18); border-radius: var(--radius-sm); font-size: .8rem; }
    .logo { border-radius: 6px; display: block; }
    .project-crumb { display: inline-flex; align-items: center; gap: .35rem; color: rgba(255,255,255,.85); font-size: .85rem; }
    .project-crumb a { color: #fff; text-decoration: underline; text-underline-offset: 3px; }
    .project-crumb__sep { opacity: .7; }
    .topbar__theme { background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.22); color: #fff; border-radius: 999px; padding: .35rem .6rem; cursor: pointer; display: inline-flex; gap: .25rem; }
    .topbar__theme [data-theme-icon] { display: none; }
    [data-theme="light"] [data-theme-icon="light"], [data-theme="dark"] [data-theme-icon="dark"], [data-theme="system"] [data-theme-icon="system"] { display: inline; }
    .topbar__login { background: #fff; color: var(--accent); padding: .4rem .75rem; border-radius: 999px; font-weight: 600; font-size: .85rem; text-decoration: none; }
    .user-menu { display: inline-flex; align-items: center; gap: .5rem; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.2); padding: .2rem .5rem .2rem .3rem; border-radius: 999px; font-size: .85rem; }
    .user-menu__avatar { width: 26px; height: 26px; border-radius: 999px; object-fit: cover; background: rgba(255,255,255,.2); }
    .user-menu__avatar--fallback { display: inline-grid; place-items: center; font-weight: 700; color: #fff; }
    .user-menu__name { color: #fff; font-weight: 600; max-width: 12ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .user-menu__role { font-size: .65rem; text-transform: uppercase; letter-spacing: .06em; background: rgba(255,255,255,.2); color: #fff; padding: .15rem .4rem; border-radius: 999px; }
    .user-menu__logout { color: #fff; font-size: .8rem; text-decoration: underline; text-underline-offset: 2px; margin-left: .25rem; background: none; border: none; cursor: pointer; padding: 0; }`;
}

function sidebarCss(): string {
  return `
    .shell { max-width: 1440px; margin: 0 auto; display: grid; grid-template-columns: var(--sidebar-width) 1fr; min-height: calc(100vh - 52px); }
    .sidebar { background: var(--sidebar-bg); border-right: 1px solid var(--border); padding: .75rem .625rem; position: sticky; top: 52px; height: calc(100vh - 52px); overflow: auto; }
    .sidebar__nav { display: flex; flex-direction: column; gap: 1px; }
    .sidebar__section { margin: .875rem 0 .25rem; font-size: .68rem; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); padding: 0 .625rem; }
    .sidebar__link { position: relative; display: flex; align-items: center; gap: .5rem; padding: .55rem .625rem; border-radius: var(--radius-sm); color: var(--text-secondary); font-size: .875rem; text-decoration: none; min-height: 40px; }
    .sidebar__link:hover { background: var(--surface-muted); color: var(--text-primary); text-decoration: none; }
    .sidebar__link--active { background: var(--surface-muted); color: var(--text-primary); font-weight: 600; }
    .sidebar__link--active::before { content: ""; position: absolute; left: -.625rem; top: 20%; bottom: 20%; width: 3px; border-radius: 999px; background: var(--accent); }`;
}

function contentCss(): string {
  return `
    .content { padding: 1.25rem 1.5rem 2.5rem; min-width: 0; max-width: 1200px; }
    @media (max-width: 880px) {
      .topbar__menu { display: inline-flex; }
      .shell { grid-template-columns: 1fr; }
      .sidebar { display: none; position: fixed; inset: 52px 0 0 0; z-index: 30; height: auto; }
      .sidebar--open { display: block; }
      .content { padding: 1rem; }
    }`;
}
