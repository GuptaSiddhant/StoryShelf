import type { Build } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import type { Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Badge, Meta, statusTone } from "../ui/components.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** Snapshot navigator props for the diff review page. */
export interface DiffNavProps {
  project: Project;
  build: Build;
  snapshots: Snapshot[];
  selectedId?: string;
}

/** Left-rail snapshot list with per-story status and diff ratios. */
export function DiffNav(props: DiffNavProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, snapshots, selectedId } = props;
  return (
    <div class="review-nav">
      <div class="card">
        <div class="review-nav__head">
          <strong>Snapshots</strong>
          <Meta as="span">{snapshots.length} total</Meta>
        </div>
        <div data-diff-nav data-current={selectedId} class="review-nav__list">
          {snapshots.map((snap): HtmlEscapedString | Promise<HtmlEscapedString> => (
            <a
              key={snap.id}
              href={`/projects/${project.slug}/builds/${build.id}/diff?snapshot=${snap.id}`}
              data-snapshot-link
              data-snapshot-id={snap.id}
              class={`snapshot-nav ${selectedId === snap.id ? "snapshot-nav--active" : ""}`}
              hx-get={`/projects/${project.slug}/builds/${build.id}/diff?snapshot=${snap.id}`}
              hx-target="body"
              hx-push-url="true"
            >
              <span class="snapshot-nav__title">
                <Badge tone={statusTone(snap.status)}>{snap.status}</Badge>
                <span class="truncate">
                  {snap.storyTitle} / {snap.storyName}
                </span>
              </span>
              <span class="snapshot-nav__meta">
                {snap.viewportName} · {snap.viewportWidth}×{snap.viewportHeight}
                {snap.diffRatio !== null && snap.diffRatio !== undefined
                  ? ` · ${(snap.diffRatio * 100).toFixed(1)}%`
                  : ""}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
