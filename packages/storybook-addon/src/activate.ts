/** Turns the addon on for a page it supports, and only then changes anything or makes a request. */
import { fetchStoryStatus, type Fetcher } from "./client.ts";
import { buildLocationOf, isOpaqueOrigin, reviewUrlOf } from "./location.ts";
import { createLabelRenderer, type LabelRenderer } from "./render-label.ts";
import { createBadgeStore } from "./store.ts";

/** The part of Storybook's `addons` manager the addon calls. */
export interface ConfigHost {
  setConfig(config: { sidebar: { renderLabel: LabelRenderer } }): void;
}

/** What the page tells the addon. */
export interface PageEnv {
  /** `self.origin`; `"null"` for a sandboxed page. */
  origin: string;
  /** `location.pathname` after any redirect. */
  pathname: string;
  fetcher: Fetcher;
  /** Opens a review link; the manager passes a `window.open` with `noopener`. */
  open: (url: string) => void;
}

/**
 * On a build's published Storybook on the app origin, install the label renderer (Storybook reads
 * it when the story index arrives, so before any request), then read the status: badges appear if
 * testing is on and the viewer may read the build. Anywhere else (a local `storybook dev`, a
 * subdomain, a sandbox) it changes nothing and requests nothing. Resolves true once badges are set.
 */
export async function activate(host: ConfigHost, env: PageEnv): Promise<boolean> {
  const location = buildLocationOf(env.pathname);
  if (isOpaqueOrigin(env.origin) || !location) return false;
  const store = createBadgeStore();
  host.setConfig({ sidebar: { renderLabel: createLabelRenderer(store, env.open) } });
  const status = await fetchStoryStatus(env.fetcher, location);
  const reviewUrl = status ? reviewUrlOf(status.build.reviewPath, env.origin) : null;
  if (!status || !reviewUrl) return false;
  store.set({ status, reviewUrl });
  return true;
}
