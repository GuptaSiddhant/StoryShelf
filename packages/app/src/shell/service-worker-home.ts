import { DEVICE_SCRIPT } from "./service-worker-device.ts";
import { SERVE_SCRIPT } from "./service-worker-serve.ts";

/** One kept project, as the worker stores it (only what the home page reads). */
export interface OfflineHomeProject {
  name: string;
  commit: string;
  syncedAt: string;
  maxOfflineDays: number;
}

/**
 * The HTML the worker answers at `/offline`, for a given device state. It runs the worker's own
 * `homePage` (not a copy), so stories and tests see exactly what a device shows. Page-side only:
 * the worker never imports this.
 */
export async function renderOfflineHome(
  projects: Readonly<Record<string, OfflineHomeProject>>,
): Promise<string> {
  const state = { projects, capBytes: 0 };
  // oxlint-disable-next-line typescript/no-implied-eval -- runs the worker's own trusted script text, so a story shows the real page
  const run = new Function(
    "state",
    `${DEVICE_SCRIPT}${SERVE_SCRIPT}
    function loadState(){ return Promise.resolve(state); }
    return homePage(200).then(function(res){ return res.text(); });`,
  ) as (state: unknown) => Promise<string>;
  return await run(state);
}
