import type { FC } from "hono/jsx";
import { assetManifest } from "../asset-manifest.ts";
import { getCsrfToken } from "../middleware/csrf.ts";
import { getStore } from "../store.ts";
import { Style, css } from "./css.ts";
import { BareShell } from "./shell/bare.tsx";
import { bootScript } from "./shell/boot-script.ts";
import { clientScript } from "./shell/client-script.ts";
import type { NavConfig } from "./shell/nav.ts";
import { Sidebar } from "./shell/sidebar.tsx";
import { ToastRegion, TopBar } from "./shell/topbar.tsx";
import { baseStyle } from "./styles.ts";
import { DARK_THEME, LIGHT_THEME } from "./theme.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

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
  const light = ui.lightTheme ?? LIGHT_THEME;
  const dark = ui.darkTheme ?? DARK_THEME;

  return (
    <html lang="en" data-theme="system">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="csrf-token" content={getCsrfToken(config.secret, sessionId)} />
        {ui.favicon ? <link rel="icon" href={ui.favicon} /> : null}
        <title>
          {title} · {name}
        </title>
        <style dangerouslySetInnerHTML={{ __html: baseStyle(light, dark) }} />
        <Style />
        <script dangerouslySetInnerHTML={{ __html: bootScript() }} />
      </head>
      <body>
        <a class="skip-link" href="#main-content">
          Skip to content
        </a>
        {layout === "bare" ? (
          <BareShell name={name} logo={ui.logo}>
            {children}
          </BareShell>
        ) : (
          <>
            <div class={shellRoot}>
              <Sidebar nav={nav} name={name} logo={ui.logo} />
              <div>
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
        )}
        <ToastRegion />
        <script src={assetManifest.htmx.href} />
        <script dangerouslySetInnerHTML={{ __html: clientScript() }} />
      </body>
    </html>
  );
};
