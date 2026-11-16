/** Storybook manager entry: sets the sidebar label, which stays inert outside a published build. */
import { activate } from "./activate.ts";
import { addons } from "./manager-api.ts";

function start(): void {
  activate(addons, {
    origin: globalThis.origin,
    pathname: globalThis.location.pathname,
    fetcher: async (input, init) => await fetch(input, init),
    open: (url) => {
      globalThis.open(url, "_blank", "noopener,noreferrer");
    },
  }).catch(() => false);
}

start();
