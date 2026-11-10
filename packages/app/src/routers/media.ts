import type { ShelfRouter } from "../app-types.ts";
import {
  serveBaseline,
  serveDesignRender,
  serveSnapshotDiff,
  serveSnapshotImage,
} from "./media.handlers.ts";

const SNAPSHOT = "/api/v1/projects/:slug/builds/:buildId/snapshots/:snapshotId";

/** Register the PNG image, diff, and baseline media endpoints for snapshots. */
export function registerMedia(app: ShelfRouter): void {
  app.get(`${SNAPSHOT}/image`, async (c) => await serveSnapshotImage(c));
  app.get(`${SNAPSHOT}/diff`, async (c) => await serveSnapshotDiff(c));
  app.get(
    "/api/v1/projects/:slug/design/renders/:renderId",
    async (c) => await serveDesignRender(c),
  );
  app.get(`${SNAPSHOT}/baseline`, async (c) => await serveBaseline(c));
}
