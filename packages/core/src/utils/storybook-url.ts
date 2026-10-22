/** The Storybook URL a runner opens for a `reach: "url"` target (ADR 0007, decision 5). */

/**
 * The root of a build's Storybook from the URL core hands a runner, without its trailing slash. The
 * URL is the directory root `<origin>/_s/<token>/` and nothing else: no `iframe.html`, no query, no
 * fragment, and a path ending in a slash. Anything else throws, so a runner never silently opens a
 * different page than the one core signed. The URL carries a token and is never logged, nor is it
 * quoted in the error.
 */
export function storybookBase(storybookUrl: string): string {
  const url = new URL(storybookUrl);
  if (url.search !== "" || url.hash !== "" || !url.pathname.endsWith("/")) {
    throw new Error(
      "The Storybook URL must be the build's directory root (ending in a slash, no query or fragment)",
    );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
}
