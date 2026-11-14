import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { assetManifest } from "../asset-manifest.ts";
import { getCsrfToken } from "../middleware/csrf.ts";
import { MANIFEST_PATH } from "../routers/manifest.ts";
import { getStore } from "../store.ts";
import { Style, css } from "../ui/css.ts";
import { baseStyle } from "../ui/styles.ts";
import { DARK_THEME, LIGHT_THEME, type BrandTheme } from "../ui/theme.ts";
import { BareShell } from "./bare.tsx";
import { bootScript } from "./boot-script.ts";
import type { NavConfig } from "./nav.ts";
import { Sidebar } from "./sidebar.tsx";
import { ToastRegion, TopBar } from "./topbar.tsx";
/** Active section, project, and breadcrumb trail passed to the shell. */
export type { NavConfig };

/** Rendered HTML content returned by page components. */
export type RenderedContent = string | Promise<string>;

/**
 * Page frame: `default` is a readable column, `wide` uses the full viewport,
 * `bare` drops the app chrome (sign-in, invites).
 */
type PageLayout = "default" | "wide" | "bare";

const shellRoot = css`
  /* shell */
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  min-height: 100vh;
  @media (max-width: 880px) {
    & {
      grid-template-columns: minmax(0, 1fr);
    }
  }
`;

const shellContent = css`
  /* shell-content */
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-6) var(--space-8);
  min-width: 0;
  @media (max-width: 880px) {
    & {
      padding: var(--space-4);
    }
  }
`;

const shellContentWide = css`
  /* shell-content-wide */
  ${shellContent}
  max-width: none;
`;

const shellBackdrop = css`
  /* shell-backdrop */
  position: fixed;
  inset: 0;
  z-index: 55;
  background: rgb(0 0 0 / 0.4);
  &[hidden] {
    display: none;
  }
`;

/** The document head: metadata, the CSRF token, the base styles and the boot script. */
const DocumentHead: FC<{
  title: string;
  name: string;
  csrfToken: string;
  styles: string;
  light: BrandTheme;
  dark: BrandTheme;
  sidebarDefault?: "rail" | undefined;
}> = ({ title, name, csrfToken, styles, light, dark, sidebarDefault }) => (
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="csrf-token" content={csrfToken} />
    {/* Favicon is the product's own mark, not brandable: it identifies
        StoryShelf in the tab strip. `ui.logo` stays overridable. */}
    <link rel="icon" type="image/svg+xml" href={assetManifest.mark.href} />
    <link rel="manifest" href={MANIFEST_PATH} />
    <meta name="theme-color" content={light.surface.base} media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content={dark.surface.base} media="(prefers-color-scheme: dark)" />
    <title>
      {title} · {name}
    </title>
    <style dangerouslySetInnerHTML={{ __html: styles }} />
    <Style />
    <script dangerouslySetInnerHTML={{ __html: bootScript(sidebarDefault) }} />
  </head>
);

/** The app chrome around a page: sidebar, top bar, the content column and the sidebar backdrop. */
const AppChrome: FC<{
  nav?: NavConfig;
  name: string;
  logo: string;
  layout: PageLayout;
  children?: unknown;
}> = ({ nav, name, logo, layout, children }) => (
  <>
    <div class={shellRoot}>
      <Sidebar nav={nav} name={name} logo={logo} />
      <div data-shell-main>
        <TopBar nav={nav} />
        <main
          id="main-content"
          class={layout === "wide" ? shellContentWide : shellContent}
          tabindex={-1}
        >
          {children}
        </main>
      </div>
    </div>
    <div class={shellBackdrop} data-sidebar-backdrop hidden />
  </>
);

// Hono's JSX.Element is typed as `HtmlEscapedString | Promise<...>`, so JSX-returning
// Functions can legitimately return a promise; the rule is a false positive here.
/** Full HTML document shell with sidebar, top bar, theme, toasts, and HTMX. */
export const DocumentLayout: FC<{
  title: string;
  nav?: NavConfig;
  layout?: PageLayout;
  children?: unknown;
}> = ({ title, nav, layout = "default", children }) => {
  const { ui, config, sessionId } = getStore();
  const name = ui.name ?? "StoryShelf";
  const logo = ui.logo ?? assetManifest.mark.href;
  const light = ui.lightTheme ?? LIGHT_THEME;
  const dark = ui.darkTheme ?? DARK_THEME;

  return (
    <>
      {/* Without a doctype browsers use quirks mode (form margins, line-box struts, …). */}
      {raw("<!DOCTYPE html>")}
      <html lang="en" data-theme="system">
        <DocumentHead
          title={title}
          name={name}
          csrfToken={getCsrfToken(config.secret, sessionId)}
          styles={baseStyle(light, dark)}
          light={light}
          dark={dark}
          sidebarDefault={nav?.sidebarDefault}
        />
        <body>
          <a class="skip-link" href="#main-content">
            Skip to content
          </a>
          {layout === "bare" ? (
            <BareShell name={name} logo={logo}>
              {children}
            </BareShell>
          ) : (
            <AppChrome nav={nav} name={name} logo={logo} layout={layout}>
              {children}
            </AppChrome>
          )}
          <ToastRegion />
          <script src={assetManifest.htmx.href} />
          <script src={assetManifest.client.href} />
        </body>
      </html>
    </>
  );
};
