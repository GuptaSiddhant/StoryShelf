/**
 * Story-only: show an already-rendered signed preview in a state the shell script reaches at run
 * time (the renewal notice, a reload in flight, a second failure), so each is a deterministic story
 * without the script, timers or a failing network. It edits the rendered HTML only: `PreviewEmbed`
 * keeps rendering the healthy default and nothing in production changes.
 */
export type PreviewState = "failed" | "reloading" | "failed-again";

/** The opening tag of an element that carries the attribute `name` (rendered as `name="true"`). */
function openingTag(name: string): RegExp {
  return new RegExp(`<(?<tag>[a-z]+)\\b(?<attrs>[^>]*\\s${name}="true"[^>]*)>`, "u");
}

/** Change the attributes of the first element that carries `marker`. */
function withAttributes(html: string, marker: string, change: (attrs: string) => string): string {
  return html.replace(openingTag(marker), (_match, ...rest: unknown[]) => {
    const groups = rest.at(-1) as { tag: string; attrs: string };
    return `<${groups.tag}${change(groups.attrs)}>`;
  });
}

const unhide = (attrs: string): string => attrs.replace(/\shidden=""/u, "");
const hide = (attrs: string): string => (/\shidden=""/u.test(attrs) ? attrs : `${attrs} hidden=""`);

/** The notice replaces the disclosure line, as the script does after the last failed retry. */
function failed(html: string): string {
  return withAttributes(
    withAttributes(html, "data-preview-disclosure", hide),
    "data-preview-notice",
    unhide,
  );
}

/** Show a signed preview's notes in `state` (an unsigned preview has none, and is unchanged). */
export function previewState(html: string, state?: PreviewState): string {
  if (!state) {
    return html;
  }
  let next = failed(html);
  if (state === "reloading") {
    next = withAttributes(next, "data-preview-notice", (attrs) => `${attrs} aria-busy="true"`);
    next = withAttributes(next, "data-preview-reload", (attrs) => `${attrs} disabled=""`);
    next = next.replace(
      /(?<head>data-preview-reload="true"[^>]*>)Reload preview/u,
      "$<head>Reloading…",
    );
  }
  if (state === "failed-again") {
    next = withAttributes(next, "data-preview-again", unhide);
  }
  return next;
}
