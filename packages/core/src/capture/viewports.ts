import type { Viewport } from "./adapter.ts";

/** Default viewports used when a deployment does not configure any. */
export const DEFAULT_VIEWPORTS: Viewport[] = [{ name: "desktop", width: 1280, height: 720 }];
