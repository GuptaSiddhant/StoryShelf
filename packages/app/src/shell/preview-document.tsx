import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { getStore } from "../store.ts";
import { css, Style } from "../ui/css.ts";
import { baseStyle } from "../ui/styles.ts";
import { DARK_THEME, LIGHT_THEME } from "../ui/theme.ts";
import { THEME_BOOT_SCRIPT } from "./boot-script.ts";

const previewRoot = css`
  /* preview-root */
  height: 100%;
`;

const previewBody = css`
  /* preview-body */
  height: 100%;
  display: flex;
  flex-direction: column;
`;

/**
 * The light document around a published Storybook: its viewer bar and its Preparing page. It has
 * the app's tokens, reset and saved theme but none of the app shell (no sidebar, no HTMX, no
 * service worker), because the viewer wraps a sandboxed frame and the Preparing page polls.
 */
export const PreviewDocument: FC<{ title: string; children?: unknown }> = ({ title, children }) => {
  const { ui } = getStore();
  const name = ui.name ?? "StoryShelf";
  const light = ui.lightTheme ?? LIGHT_THEME;
  const dark = ui.darkTheme ?? DARK_THEME;
  return (
    <>
      {raw("<!DOCTYPE html>")}
      <html lang="en" data-theme="system" class={previewRoot}>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="color-scheme" content="light dark" />
          <title>
            {title} · {name}
          </title>
          <style dangerouslySetInnerHTML={{ __html: baseStyle(light, dark) }} />
          <Style />
          <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        </head>
        <body class={previewBody}>{children}</body>
      </html>
    </>
  );
};
