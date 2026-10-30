import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import type { DefaultComparison } from "../routers/baseline-reference.ts";
import { HStack } from "../ui/components.tsx";
import { css } from "../ui/css.ts";
import { snapshotImageUrl } from "./build-diff-model.ts";

const comparisonImage = css`
  /* default-comparison-image */
  max-width: 100%;
`;

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
        <HStack align="start">
          <BaselineImage src={baseline} />
          <figure>
            <figcaption>This build</figcaption>
            <img
              src={snapshotImageUrl(project, build, snapshot, "image")}
              alt="This build's screenshot"
              class={comparisonImage}
            />
          </figure>
        </HStack>
      ) : (
        <p>The current default-branch baseline image is unavailable.</p>
      )}
    </details>
  );
}

function BaselineImage(props: { src: string }): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <figure>
      <figcaption>Current default-branch baseline</figcaption>
      <img
        src={props.src}
        alt="Current default-branch baseline"
        loading="lazy"
        class={comparisonImage}
      />
    </figure>
  );
}
