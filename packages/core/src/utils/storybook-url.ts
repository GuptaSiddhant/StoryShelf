/** The Storybook URL a runner opens for a `reach: "url"` target (ADR 0007, decision 5). */

/**
 * The root of a build's Storybook, the URL `iframe.html` is served under, from the URL core hands a
 * runner: with or without a trailing `/iframe.html` or slash, so either spelling of the signed URL
 * works. Query and fragment are dropped. The URL carries a token and is never logged.
 */
export function storybookBase(storybookUrl: string): string {
  const url = new URL(storybookUrl);
  url.search = "";
  url.hash = "";
  const path = url.pathname.replace(/\/iframe\.html$/u, "").replace(/\/+$/u, "");
  return `${url.origin}${path}`;
}
