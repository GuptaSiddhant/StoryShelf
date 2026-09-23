import type { FC } from "hono/jsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { getStore } from "../store.ts";
import { Style, css } from "./css.ts";
import { baseStyle } from "./styles.ts";
import { DARK_THEME, LIGHT_THEME } from "./theme.ts";

/** Rendered HTML content returned by page components. */
export type RenderedContent = string | Promise<string>;

interface NavConfig {
  active?: string;
  projectSlug?: string;
  projectName?: string;
}

/**
 * App chrome styles, colocated with the shell that renders them.
 *
 * Each template scopes one subtree: top-level declarations style the
 * hashed root itself, nested selectors style descendants (native CSS
 * nesting). Truly global rules (skip-link, theme-icon visibility) stay in
 * the global stylesheet (`styles/base.ts`, `styles/behavior.ts`).
 */
const shellTopbar = css`
  /* shell-topbar */
  position: sticky;
  top: 0;
  z-index: 40;
  background: var(--topbar-bg);
  color: #fff;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  .topbar__inner {
    max-width: 1440px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 1rem;
  }
  .topbar__left,
  .topbar__right {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-width: 0;
  }
  .topbar__menu {
    display: none;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.3);
    color: #fff;
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    min-height: 44px;
    min-width: 44px;
    align-items: center;
    justify-content: center;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: #fff;
    font-weight: 650;
    font-size: 0.95rem;
    text-decoration: none;
  }
  .brand__mark {
    width: 26px;
    height: 26px;
    display: inline-grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.18);
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
  }
  .logo {
    border-radius: 6px;
    display: block;
  }
  .project-crumb {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.85rem;
  }
  .project-crumb a {
    color: #fff;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .project-crumb__sep {
    opacity: 0.7;
  }
  .topbar__theme {
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.22);
    color: #fff;
    border-radius: 999px;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
    display: inline-flex;
    gap: 0.25rem;
  }
  .topbar__theme [data-theme-icon] {
    display: none;
  }
  .topbar__login {
    background: #fff;
    color: var(--accent);
    padding: 0.4rem 0.75rem;
    border-radius: 999px;
    font-weight: 600;
    font-size: 0.85rem;
    text-decoration: none;
  }
  .user-menu {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.2);
    padding: 0.2rem 0.5rem 0.2rem 0.3rem;
    border-radius: 999px;
    font-size: 0.85rem;
  }
  .user-menu__avatar {
    width: 26px;
    height: 26px;
    border-radius: 999px;
    object-fit: cover;
    background: rgba(255, 255, 255, 0.2);
  }
  .user-menu__avatar--fallback {
    display: inline-grid;
    place-items: center;
    font-weight: 700;
    color: #fff;
  }
  .user-menu__name {
    color: #fff;
    font-weight: 600;
    max-width: 12ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .user-menu__role {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
    padding: 0.15rem 0.4rem;
    border-radius: 999px;
  }
  .user-menu__logout {
    color: #fff;
    font-size: 0.8rem;
    text-decoration: underline;
    text-underline-offset: 2px;
    margin-left: 0.25rem;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }
  @media (max-width: 880px) {
    & .topbar__menu {
      display: inline-flex;
    }
  }
`;

const shellSidebar = css`
  /* shell-sidebar */
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
  padding: 0.75rem 0.625rem;
  position: sticky;
  top: 52px;
  height: calc(100vh - 52px);
  overflow: auto;
  .sidebar__nav {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .sidebar__section {
    margin: 0.875rem 0 0.25rem;
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    padding: 0 0.625rem;
  }
  .sidebar__link {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.625rem;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: 0.875rem;
    text-decoration: none;
    min-height: 40px;
  }
  .sidebar__link:hover {
    background: var(--surface-muted);
    color: var(--text-primary);
    text-decoration: none;
  }
  .sidebar__link--active {
    background: var(--surface-muted);
    color: var(--text-primary);
    font-weight: 600;
  }
  .sidebar__link--active::before {
    content: "";
    position: absolute;
    left: -0.625rem;
    top: 20%;
    bottom: 20%;
    width: 3px;
    border-radius: 999px;
    background: var(--accent);
  }
  @media (max-width: 880px) {
    & {
      display: none;
      position: fixed;
      inset: 52px 0 0 0;
      z-index: 30;
      height: auto;
    }
    &.sidebar--open {
      display: block;
    }
  }
`;

const shellLayout = css`
  /* shell-layout */
  max-width: 1440px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  min-height: calc(100vh - 52px);
  .content {
    padding: 1.25rem 1.5rem 2.5rem;
    min-width: 0;
    max-width: 1200px;
  }
  @media (max-width: 880px) {
    & {
      grid-template-columns: 1fr;
    }
    & .content {
      padding: 1rem;
    }
  }
`;

// Hono's JSX.Element is typed as `HtmlEscapedString | Promise<...>`, so JSX-returning
// Functions can legitimately return a promise; the rule is a false positive here.
/** Full HTML document shell with top bar, sidebar, theme, and HTMX. */
// eslint-disable-next-line promise-function-async -- JSX component return type
export const DocumentLayout: FC<{ title: string; nav?: NavConfig; children?: unknown }> = ({
  title,
  nav,
  children,
}) => {
  const { ui, config } = getStore();
  const name = ui.name ?? "StoryShelf";
  const light = ui.lightTheme ?? LIGHT_THEME;
  const dark = ui.darkTheme ?? DARK_THEME;

  return (
    <html lang="en" data-theme="system">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="csrf-token" content={getCsrfToken(config.secret)} />
        {ui.favicon ? <link rel="icon" href={ui.favicon} /> : null}
        <title>
          {title} · {name}
        </title>
        <style dangerouslySetInnerHTML={{ __html: baseStyle(light, dark) }} />
        <Style />
        <script dangerouslySetInnerHTML={{ __html: themeScript() }} />
      </head>
      <body>
        <a class="skip-link" href="#main-content">
          Skip to content
        </a>
        <TopBar name={name} logo={ui.logo} nav={nav} />
        <div class={shellLayout}>
          <Sidebar nav={nav} />
          <main id="main-content" class="content" tabindex={-1}>
            {children}
          </main>
        </div>
        <script src="/assets/htmx.js" />
        <script dangerouslySetInnerHTML={{ __html: clientScript() }} />
      </body>
    </html>
  );
};

// eslint-disable-next-line promise-function-async -- JSX component return type
const TopBar: FC<{ name: string; logo?: string; nav?: NavConfig }> = ({ name, logo, nav }) => {
  return (
    <header class={shellTopbar} role="banner">
      <div class="topbar__inner">
        <div class="topbar__left">
          <button
            class="topbar__menu"
            type="button"
            aria-label="Toggle navigation"
            aria-expanded="false"
            aria-controls="sidebar"
            data-sidebar-toggle
          >
            <span aria-hidden="true">☰</span>
          </button>
          <a class="brand" href="/">
            {logo ? (
              <img class="logo" src={logo} alt={name} width="28" height="28" />
            ) : (
              <span class="brand__mark" aria-hidden="true">
                ◆
              </span>
            )}
            <span class="brand__name">{name}</span>
          </a>
          {nav?.projectSlug ? (
            <nav class="project-crumb" aria-label="Project">
              <span class="project-crumb__sep" aria-hidden="true">
                /
              </span>
              <a href={`/projects/${nav.projectSlug}/builds`}>
                {nav.projectName ?? nav.projectSlug}
              </a>
            </nav>
          ) : null}
        </div>
        <div class="topbar__right">
          <ThemeToggle />
          <AuthMenu />
        </div>
      </div>
    </header>
  );
};

// eslint-disable-next-line promise-function-async -- JSX component return type
const ThemeToggle: FC = () => {
  return (
    <button class="topbar__theme" type="button" aria-label="Toggle theme" data-theme-toggle>
      <span data-theme-icon="light" aria-hidden="true">
        ☀
      </span>
      <span data-theme-icon="dark" aria-hidden="true">
        ☾
      </span>
      <span data-theme-icon="system" aria-hidden="true">
        ◐
      </span>
    </button>
  );
};

// eslint-disable-next-line promise-function-async -- JSX component return type
const AuthMenu: FC = () => {
  const { user, authEnabled } = getStore();
  if (!authEnabled) {
    return null;
  }
  if (!user) {
    return (
      <a class="topbar__login" href="/auth/login">
        Sign in
      </a>
    );
  }
  return (
    <div class="user-menu">
      {user.avatarUrl ? (
        <img class="user-menu__avatar" src={user.avatarUrl} alt="" width="28" height="28" />
      ) : (
        <span class="user-menu__avatar user-menu__avatar--fallback" aria-hidden="true">
          {user.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span class="user-menu__name">{user.name}</span>
      <span class={`user-menu__role user-menu__role--${user.role}`}>{user.role}</span>
      <form method="post" action="/auth/logout">
        <button class="user-menu__logout" type="submit">
          Sign out
        </button>
      </form>
    </div>
  );
};

// eslint-disable-next-line promise-function-async -- JSX component return type
const Sidebar: FC<{ nav?: NavConfig }> = ({ nav }) => {
  return (
    <aside id="sidebar" class={shellSidebar} aria-label="Primary">
      <nav class="sidebar__nav">
        <a
          class={`sidebar__link ${nav?.active === "projects" ? "sidebar__link--active" : ""}`}
          href="/projects"
          aria-current={nav?.active === "projects" ? "page" : undefined}
        >
          <span aria-hidden="true">▦</span> Projects
        </a>
        {nav?.projectSlug ? (
          <>
            <div class="sidebar__section">Project</div>
            <a
              class={`sidebar__link ${nav.active === "builds" ? "sidebar__link--active" : ""}`}
              href={`/projects/${nav.projectSlug}/builds`}
              aria-current={nav.active === "builds" ? "page" : undefined}
            >
              <span aria-hidden="true">◧</span> Builds
            </a>
            <a
              class={`sidebar__link ${nav.active === "jobs" ? "sidebar__link--active" : ""}`}
              href={`/projects/${nav.projectSlug}/jobs`}
              aria-current={nav.active === "jobs" ? "page" : undefined}
            >
              <span aria-hidden="true">◫</span> Jobs
            </a>
            <a
              class={`sidebar__link ${nav.active === "labels" ? "sidebar__link--active" : ""}`}
              href={`/projects/${nav.projectSlug}/labels`}
              aria-current={nav.active === "labels" ? "page" : undefined}
            >
              <span aria-hidden="true">⌗</span> Labels
            </a>
            <a
              class={`sidebar__link ${nav.active === "library" ? "sidebar__link--active" : ""}`}
              href={`/projects/${nav.projectSlug}/library`}
              aria-current={nav.active === "library" ? "page" : undefined}
            >
              <span aria-hidden="true">▤</span> Library
            </a>
            <a
              class={`sidebar__link ${nav.active === "settings" ? "sidebar__link--active" : ""}`}
              href={`/projects/${nav.projectSlug}/settings`}
              aria-current={nav.active === "settings" ? "page" : undefined}
            >
              <span aria-hidden="true">⚙</span> Settings
            </a>
          </>
        ) : null}
        <div class="sidebar__section">Developer</div>
        <a
          class={`sidebar__link ${nav?.active === "api-docs" ? "sidebar__link--active" : ""}`}
          href="/api/v1/docs"
          aria-current={nav?.active === "api-docs" ? "page" : undefined}
          aria-label="API docs (Swagger UI)"
          title="Interactive OpenAPI — Swagger UI"
        >
          API docs
        </a>
        <a
          class="sidebar__link"
          href="/api/v1/openapi.json"
          aria-label="OpenAPI spec (JSON)"
          title="Raw OpenAPI 3.0 JSON"
          target="_blank"
          rel="noopener"
        >
          OpenAPI spec ↗
        </a>
      </nav>
    </aside>
  );
};

function themeScript(): string {
  return `
  (function(){
    var cookieName='storyshelf_theme';
    function readCookie(n){
      var m=document.cookie.match(new RegExp('(?:^|; )'+n.replace(/([.$?*|{}\\[\\]\\\\/\\+^])/gu,'\\\\$1')+'=([^;]*)'));
      return m?decodeURIComponent(m[1]):null;
    }
    function writeCookie(n,v){
      document.cookie=n+'='+encodeURIComponent(v)+'; Path=/; Max-Age=31536000; SameSite=Lax';
    }
    function applyTheme(v){
      var html=document.documentElement;
      if(v==='light'||v==='dark'||v==='system'){ html.setAttribute('data-theme',v); }
      else { html.setAttribute('data-theme','system'); }
    }
    var initial=readCookie(cookieName);
    if(initial){ applyTheme(initial); }
    window.__storyshelfTheme={readCookie:readCookie,writeCookie:writeCookie,applyTheme:applyTheme,cookieName:cookieName};
  })();
  `.trim();
}

function clientScript(): string {
  return `
  (function(){
    var theme=window.__storyshelfTheme;
    var csrfMeta=document.querySelector('meta[name="csrf-token"]');
    if(csrfMeta){
      document.body.addEventListener('htmx:configRequest',function(e){
        e.detail.headers['x-csrf-token']=csrfMeta.getAttribute('content');
      });
    }
    var toggle=document.querySelector('[data-theme-toggle]');
    if(toggle&&theme){
      toggle.addEventListener('click',function(){
        var cur=document.documentElement.getAttribute('data-theme')||'system';
        var next=cur==='system'?'light':cur==='light'?'dark':'system';
        theme.applyTheme(next);
        theme.writeCookie(theme.cookieName,next);
      });
    }
    var menuBtn=document.querySelector('[data-sidebar-toggle]');
    var sidebar=document.getElementById('sidebar');
    if(menuBtn&&sidebar){
      menuBtn.addEventListener('click',function(){
        var open=sidebar.classList.toggle('sidebar--open');
        menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape'&&sidebar&&sidebar.classList.contains('sidebar--open')){
        sidebar.classList.remove('sidebar--open');
        if(menuBtn) menuBtn.setAttribute('aria-expanded','false');
        menuBtn && menuBtn.focus();
      }
    });
    // HTMX after swap focus management
    document.body.addEventListener('htmx:afterSwap',function(e){
      var target=e.detail && e.detail.target;
      if(target&&target.querySelector){
        var focusable=target.querySelector('[autofocus], input, select, textarea, button');
        if(focusable) try{ focusable.focus(); }catch(_){}
      }
    });
    // Diff view-mode segmented control (split / single pane, no endpoint change)
    function initViewSwitch(root){
      var sw=root.querySelector('[data-view-switch]');
      var grid=root.querySelector('.diff-grid');
      if(!sw||!grid) return;
      var btns=Array.from(sw.querySelectorAll('[data-view-value]'));
      sw.addEventListener('click',function(e){
        var btn=e.target instanceof HTMLElement ? e.target.closest('[data-view-value]') : null;
        if(!btn) return;
        var view=btn.getAttribute('data-view-value')||'split';
        grid.setAttribute('data-view',view);
        btns.forEach(function(b){ b.setAttribute('aria-pressed', b===btn ? 'true' : 'false'); });
      });
    }
    initViewSwitch(document);
    document.body.addEventListener('htmx:afterSwap',function(){ initViewSwitch(document); });
    // Diff keyboard shortcuts
    document.addEventListener('keydown',function(e){
      if(e.target instanceof HTMLElement && (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable)) return;
      var diffRoot=document.querySelector('[data-diff-nav]');
      if(!diffRoot) return;
      if(e.key==='ArrowLeft' || e.key==='ArrowRight'){
        var links=Array.from(diffRoot.querySelectorAll('[data-snapshot-link]'));
        if(links.length===0) return;
        var active=document.activeElement;
        var idx=links.indexOf(active);
        if(idx===-1){
          var current=diffRoot.getAttribute('data-current');
          idx=links.findIndex(function(a){ return a.getAttribute('data-snapshot-id')===current; });
        }
        var nextIdx=e.key==='ArrowRight' ? Math.min(links.length-1, idx+1) : Math.max(0, idx-1);
        if(links[nextIdx]){ e.preventDefault(); links[nextIdx].focus(); links[nextIdx].click(); }
        return;
      }
      if(e.key==='a'||e.key==='A'||e.key==='r'||e.key==='R'){
        var btn=document.querySelector(e.key==='a'||e.key==='A' ? '[data-approve]' : '[data-reject]');
        if(btn){ e.preventDefault(); btn.click(); }
      }
    });
  })();
  `.trim();
}
