import type { Build } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import type { Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Badge, Card, Meta, statusTone } from "../ui/components.tsx";
import {
  reviewNav,
  reviewNavHead,
  reviewNavList,
  snapshotNav,
  snapshotNavActive,
  snapshotNavMeta,
  snapshotNavTitle,
} from "../ui/styles/review.ts";

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
    <div class={reviewNav}>
      <Card padded={false}>
        <div class={reviewNavHead}>
          <strong>Snapshots</strong>
          <Meta as="span">{snapshots.length} total</Meta>
        </div>
        <div data-diff-nav data-current={selectedId} class={reviewNavList}>
          {snapshots.map((snap): HtmlEscapedString | Promise<HtmlEscapedString> => (
            <a
              key={snap.id}
              href={`/projects/${project.slug}/builds/${build.id}/diff?snapshot=${snap.id}`}
              data-snapshot-link
              data-snapshot-id={snap.id}
              class={selectedId === snap.id ? snapshotNavActive : snapshotNav}
              hx-get={`/projects/${project.slug}/builds/${build.id}/diff?snapshot=${snap.id}`}
              hx-target="body"
              hx-push-url="true"
            >
              <span class={snapshotNavTitle}>
                <Badge tone={statusTone(snap.status)}>{snap.status}</Badge>
                <span class="truncate">
                  {snap.storyTitle} / {snap.storyName}
                </span>
              </span>
              <span class={snapshotNavMeta}>
                {snap.viewportName} · {snap.viewportWidth}×{snap.viewportHeight}
                {snap.diffRatio !== null && snap.diffRatio !== undefined
                  ? ` · ${(snap.diffRatio * 100).toFixed(1)}%`
                  : ""}
              </span>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
