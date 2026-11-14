/**
 * The in-place answer to an approve or reject on the review page: the next snapshot's canvas
 * (swapped into `#review-canvas`), plus the header and the filmstrip out of band, so the
 * progress count and each row's status follow without a page load.
 *
 * A swap has no `<head>`, so it opens with the stylesheet its markup uses (`<Style />`, which
 * collects the classes): the shell merges the rules the page lacks into its own sheet and drops
 * the block before swapping, rather than appending the whole sheet again on every decision.
 */
import type { HtmlEscapedString } from "hono/utils/html";
import { Style } from "../ui/css.ts";
import { DiffHeader } from "./build-diff-header.tsx";
import { reviewProgress } from "./build-diff-model.ts";
import { DiffNav } from "./build-diff-nav.tsx";
import { ReviewCanvas, selectedSnapshot, type BuildDiffData } from "./build-diff.tsx";

/** Render the canvas of `data.selectedId` with the header and filmstrip as `hx-swap-oob`. */
export function renderReviewSwap(
  data: BuildDiffData,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, snapshots } = data;
  const selected = selectedSnapshot(snapshots, data.selectedId);
  return (
    <>
      <Style />
      <ReviewCanvas
        {...data}
        selected={selected}
        usage={data.usage ?? []}
        design={data.design ?? []}
      />
      <DiffHeader
        project={project}
        build={build}
        snapshots={snapshots}
        pendingCount={reviewProgress(snapshots).pending}
        canReview={data.canReview}
        canManage={data.canManage}
        details={data.details}
        oob
      />
      <DiffNav
        project={project}
        build={build}
        snapshots={snapshots}
        selectedId={selected?.id}
        oob
      />
    </>
  );
}
