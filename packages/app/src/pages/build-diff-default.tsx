import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import type { DefaultComparison } from "../routers/baseline-reference.ts";
import { snapshotImageUrl } from "./build-diff-model.ts";

/* eslint-disable promise-function-async -- Hono JSX components may return HTML or a promise */
export function DefaultComparisonView(props: {
  project: Project;
  build: Build;
  snapshot: Snapshot;
  comparison: DefaultComparison;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, snapshot, comparison } = props;
  const params = new URLSearchParams({
    reference: "default",
    id: comparison.id,
    version: comparison.version,
  });
  const baseline = `${snapshotImageUrl(project, build, snapshot, "baseline")}?${params}`;
  return (
    <details>
      <summary>Compare with current default branch ({comparison.branch})</summary>
      <p>
        This is a secondary comparison. Approval still uses the primary comparison above. Default
        baseline updated {comparison.version}.
      </p>
      <p>
        {comparison.environment === "different"
          ? "Recorded environment fingerprints differ; some components may be unknown and differences may be environmental."
          : comparison.environment === "unknown"
            ? "Capture environment information is unavailable."
            : "Recorded capture environment fingerprints match; some components may be unknown."}
      </p>
      {comparison.available ? (
        <div style="display:flex;gap:1rem;align-items:start">
          <figure>
            <figcaption>Current default-branch baseline</figcaption>
            <img src={baseline} alt="Current default-branch baseline" style="max-width:100%" />
          </figure>
          <figure>
            <figcaption>This build</figcaption>
            <img
              src={snapshotImageUrl(project, build, snapshot, "image")}
              alt="This build's screenshot"
              style="max-width:100%"
            />
          </figure>
        </div>
      ) : (
        <p>The current default-branch baseline image is unavailable.</p>
      )}
    </details>
  );
}
