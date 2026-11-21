import { createCaptureRunner } from "./capture-runner.ts";

export { createCaptureRunner };
/** @deprecated Renamed to `createCaptureRunner` in 0.15.0; this alias is removed after 0.16.0. */
export const createPlaywrightCaptureRunner = createCaptureRunner;
export { local, type BrowserEntry, type LocalBrowser, type LocalOptions } from "./targets.ts";
