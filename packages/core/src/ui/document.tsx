import type { FC } from "hono/jsx";

import { getStore } from "../store.ts";
import type { BrandTheme } from "./theme.ts";

// Hono's JSX.Element is typed as `HtmlEscapedString | Promise<...>`, so JSX-returning
// functions can legitimately return a promise; the rule is a false positive here.
// eslint-disable-next-line promise-function-async -- JSX component return type
export const DocumentLayout: FC<{ title: string; children?: unknown }> = ({ title, children }) => {
  const { ui } = getStore();
  const name = ui.name ?? "StoryShelf";
  const theme = ui.lightTheme;

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>
          {title} · {name}
        </title>
        <style>{style(theme)}</style>
      </head>
      <body>
        <header class="topbar">
          <a class="brand" href="/">
            {ui.logo ? <img class="logo" src={ui.logo} alt={name} /> : <span>{name}</span>}
          </a>
        </header>
        <main class="content">{children}</main>
      </body>
    </html>
  );
};

function style(theme?: BrandTheme): string {
  const accent = theme?.accent ?? "#2b7fff";
  const base = theme?.surface.base ?? "#f6f6f7";
  const text = theme?.text.primary ?? "#09090b";
  return `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, sans-serif; background: ${base}; color: ${text}; }
    .topbar { background: ${accent}; padding: 0.75rem 1rem; }
    .brand { color: #fff; font-weight: 600; text-decoration: none; }
    .content { max-width: 960px; margin: 0 auto; padding: 1rem; }
    a { color: ${accent}; }
  `;
}
