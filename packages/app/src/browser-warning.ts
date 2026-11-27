import { unavailableReason } from "@storyshelf/core/adapter/capture-runner";
import type { ResolvedShelfOptions } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import { trackBackground, type LifecycleCell } from "./lifecycle.ts";

/**
 * Why the default capture target (the first one the runner offers, what a project with no browsers
 * setting resolves to) cannot render, or `null` when it can, or when there is no runner or list.
 * A remote target is the farm's to provision, so only a local one (`reach: "loopback"`) counts.
 */
export function defaultTargetProblem(scoped: Pick<ResolvedShelfOptions, "testing">): string | null {
  const entry = scoped.testing?.runner.metadata.targets?.[0];
  if (entry?.reach !== "loopback") {
    return null;
  }
  const reason = unavailableReason(entry.status);
  return reason === null ? null : `${entry.target}: ${reason}`;
}

/**
 * Once adapters are ready, warn once that the default target is declared but not installed. It is
 * only a warning: health stays `ok` and no build or status changes, because the first build
 * reports the same reason.
 */
export function warnDefaultTargetAfterSetup(
  cell: LifecycleCell,
  scoped: Pick<ResolvedShelfOptions, "testing">,
  logger: Logger,
): void {
  trackBackground(
    cell,
    cell.ready.then(
      (setup) => {
        // Read after setup: the runner verifies its targets there, and until then each reads as ready.
        const problem = defaultTargetProblem(scoped);
        if (setup.ok && problem !== null) {
          logger.warn(
            {},
            `The default capture browser cannot render yet, so builds will fail. ${problem}`,
          );
        }
      },
      () => {},
    ),
  );
}
