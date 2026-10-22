/** The `afterPublish` hook that catalogues a build the moment its publishing succeeds. */
import type { AfterPublishHook } from "../publish/complete.ts";
import type { CatalogLoader } from "./load.ts";

/**
 * Catalogue every build that published successfully, whatever its verdict and with `testing` on or
 * off. A failed publish writes nothing. A build with no readable index is logged and left for the
 * lazy loader, which tries again on first view.
 */
export function createCatalogHook(loader: CatalogLoader): AfterPublishHook {
  return async ({ build, project, outcome, logger }) => {
    if (!outcome.ok) {
      return;
    }
    const catalog = await loader.refresh(project.id, build.id);
    if (!catalog) {
      logger.warn("published build has no readable Storybook index; no catalog written");
    }
  };
}
