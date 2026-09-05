import type { HtmlEscapedString } from "hono/utils/html";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import type { Snapshot } from "../schema/snapshot.ts";
import { Badge, statusTone } from "../ui/components.tsx";

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
    <div style="flex: 0 0 320px; max-width: 36%; min-width: 260px;">
      <div class="card">
        <div style="padding:.6rem .75rem; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
          <strong>Snapshots</strong>
          <span class="field__hint">{snapshots.length} total</span>
        </div>
        <div data-diff-nav data-current={selectedId} style="max-height: 70vh; overflow:auto;">
          {snapshots.map((snap): HtmlEscapedString | Promise<HtmlEscapedString> => (
            <a
              key={snap.id}
              href={`/projects/${project.slug}/builds/${build.id}/diff?snapshot=${snap.id}`}
              data-snapshot-link
              data-snapshot-id={snap.id}
              class={`snapshot-nav ${selectedId === snap.id ? "snapshot-nav--active" : ""}`}
              style={`display:flex; flex-direction:column; gap:.2rem; padding:.6rem .75rem; border-bottom:1px solid var(--border); text-decoration:none; color:inherit; background:${selectedId === snap.id ? "var(--surface-muted)" : "transparent"};`}
              hx-get={`/projects/${project.slug}/builds/${build.id}/diff?snapshot=${snap.id}`}
              hx-target="body"
              hx-push-url="true"
            >
              <span style="display:flex; gap:.4rem; align-items:center; flex-wrap:wrap;">
                <Badge tone={statusTone(snap.status)}>{snap.status}</Badge>
                <span style="font-weight:600; font-size:.9rem;">
                  {snap.storyTitle} / {snap.storyName}
                </span>
              </span>
              <span class="field__hint" style="font-size:.8rem;">
                {snap.viewportName} · {snap.viewportWidth}×{snap.viewportHeight}
                {snap.diffRatio !== null && snap.diffRatio !== undefined
                  ? ` · ${(snap.diffRatio * 100).toFixed(2)}%`
                  : ""}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
