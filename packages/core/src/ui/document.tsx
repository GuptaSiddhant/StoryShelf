import type { FC } from "hono/jsx";

import { getStore } from "../store.ts";
import { baseStyle } from "./styles.ts";
import { DARK_THEME, LIGHT_THEME } from "./theme.ts";

export type RenderedContent = string | Promise<string>;

interface NavConfig {
  active?: string;
  projectSlug?: string;
  projectName?: string;
}

// Hono's JSX.Element is typed as `HtmlEscapedString | Promise<...>`, so JSX-returning
// Functions can legitimately return a promise; the rule is a false positive here.
// eslint-disable-next-line promise-function-async -- JSX component return type
export const DocumentLayout: FC<{ title: string; nav?: NavConfig; children?: unknown }> = ({ title, nav, children }) => {
  const { ui } = getStore();
  const name = ui.name ?? "StoryShelf";
  const light = ui.lightTheme ?? LIGHT_THEME;
  const dark = ui.darkTheme ?? DARK_THEME;

  return (
    <html lang="en" data-theme="system">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        {ui.favicon ? <link rel="icon" href={ui.favicon} /> : null}
        <title>
          {title} · {name}
        </title>
        <style>{baseStyle(light, dark)}</style>
        <script dangerouslySetInnerHTML={{ __html: themeScript() }} />
      </head>
      <body>
        <a class="skip-link" href="#main-content">
          Skip to content
        </a>
        <TopBar name={name} logo={ui.logo} nav={nav} />
        <div class="shell">
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
    <header class="topbar" role="banner">
      <div class="topbar__inner">
        <div class="topbar__left">
          <button class="topbar__menu" type="button" aria-label="Toggle navigation" aria-expanded="false" aria-controls="sidebar" data-sidebar-toggle>
            <span aria-hidden="true">☰</span>
          </button>
          <a class="brand" href="/">
            {logo ? <img class="logo" src={logo} alt={name} width="28" height="28" /> : <span class="brand__mark" aria-hidden="true">◆</span>}
            <span class="brand__name">{name}</span>
          </a>
          {nav?.projectSlug ? (
            <nav class="project-crumb" aria-label="Project">
              <span class="project-crumb__sep" aria-hidden="true">
                /
              </span>
              <a href={`/projects/${nav.projectSlug}/builds`}>{nav.projectName ?? nav.projectSlug}</a>
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
    <aside id="sidebar" class="sidebar" aria-label="Primary">
      <nav class="sidebar__nav">
        <a class={`sidebar__link ${nav?.active === "projects" ? "sidebar__link--active" : ""}`} href="/projects" aria-current={nav?.active === "projects" ? "page" : undefined}>
          <span aria-hidden="true">▦</span> Projects
        </a>
        {nav?.projectSlug ? (
          <>
            <div class="sidebar__section">Project</div>
            <a class={`sidebar__link ${nav.active === "builds" ? "sidebar__link--active" : ""}`} href={`/projects/${nav.projectSlug}/builds`} aria-current={nav.active === "builds" ? "page" : undefined}>
              <span aria-hidden="true">◧</span> Builds
            </a>
            <a class={`sidebar__link ${nav.active === "jobs" ? "sidebar__link--active" : ""}`} href={`/projects/${nav.projectSlug}/jobs`} aria-current={nav.active === "jobs" ? "page" : undefined}>
              <span aria-hidden="true">◫</span> Jobs
            </a>
            <a class={`sidebar__link ${nav.active === "settings" ? "sidebar__link--active" : ""}`} href={`/projects/${nav.projectSlug}/settings`} aria-current={nav.active === "settings" ? "page" : undefined}>
              <span aria-hidden="true">⚙</span> Settings
            </a>
          </>
        ) : null}
        <div class="sidebar__section">Resources</div>
        <a class="sidebar__link" href="/api/v1/projects" aria-label="API (JSON)">
          <span aria-hidden="true">{"{} "}</span> API
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
      }
    });
  })();
  `.trim();
}
