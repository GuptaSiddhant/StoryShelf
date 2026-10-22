/** Maps `ShelfOptions` to the flat adapter slots lifecycle, validation and health probing work on. */
import type { ShelfOptions } from "../config.ts";
import type { AdapterSetupSources } from "./setup.ts";

/** The adapter slots of `options`, with `auth` carried along for boot validation. */
export function adapterSourcesOf(options: ShelfOptions): AdapterSetupSources & { auth?: unknown } {
  return {
    database: options.database,
    storage: options.storage,
    captureRunner: options.testing?.runner,
    captureQueue: options.testing?.queue,
    design: options.design,
    notifiers: options.notifications?.notifiers,
    emailSender: options.notifications?.emailSender,
    auth: options.auth,
  };
}
