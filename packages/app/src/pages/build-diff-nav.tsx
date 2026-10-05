import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Segmented, Thumbnail, statusTone } from "../ui/components.tsx";
import { css } from "../ui/css.ts";
import {
  filmBody,
  filmItem,
  filmItemActive,
  filmStatus,
  filmSub,
  filmTitle,
  filmstrip,
  filmstripHead,
  filmstripList,
  statusDots,
} from "../ui/styles/review-layout.ts";
import {
  diffPercent,
  reviewProgress,
  snapshotImageUrl,
  snapshotPageUrl,
} from "./build-diff-model.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/**
 * The list filters purely in CSS off `data-filter`, so it works before the
 * review script runs. The selected snapshot always stays visible.
 */
const filteredList = css`
  /* filmstrip-filtered */
  ${filmstripList}
  &[data-filter="review"]
    [data-status]:not([data-status="new"]):not([data-status="changed"]):not([aria-current="true"]) {
    display: none;
  }
  &[data-filter="done"]
    [data-status]:not([data-status="approved"]):not([data-status="rejected"]):not(
      [aria-current="true"]
    ) {
    display: none;
  }
`;

/** Snapshot navigator props for the diff review page. */
export interface DiffNavProps {
  project: Project;
  build: Build;
  snapshots: Snapshot[];
  selectedId?: string;
}

function FilmItem(props: {
  project: Project;
  build: Build;
  snap: Snapshot;
  active: boolean;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, snap, active } = props;
  const url = snapshotPageUrl(project, build, snap.id);
  const percent = diffPercent(snap);
  return (
    <a
      href={url}
      class={active ? filmItemActive : filmItem}
      data-snapshot-link
      data-snapshot-id={snap.id}
      data-status={snap.status}
      aria-current={active ? "true" : undefined}
      hx-get={url}
      hx-target="body"
      hx-push-url="true"
    >
      <Thumbnail src={snapshotImageUrl(project, build, snap, "image")} alt="" placeholder="…" />
      <span class={filmBody}>
        <span class={filmTitle} title={`${snap.storyTitle} / ${snap.storyName}`}>
          {snap.storyName}
        </span>
        <span class={filmSub}>{snap.storyTitle}</span>
        <span class={filmStatus}>
          <span class={statusDots[statusTone(snap.status)]} aria-hidden="true" />
          {snap.status}
          {percent ? ` · ${percent}` : ""}
        </span>
      </span>
    </a>
  );
}

/** Left filmstrip: filter chips plus a thumbnail per snapshot. */
export function DiffNav(props: DiffNavProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, snapshots, selectedId } = props;
  const progress = reviewProgress(snapshots);
  const filter = progress.pending > 0 ? "review" : "all";
  return (
    <aside class={filmstrip} aria-label="Snapshots">
      <div class={filmstripHead}>
        <Segmented
          label="Filter snapshots"
          data-filter-switch
          items={[
            {
              label: `Needs review ${progress.pending}`,
              value: "review",
              active: filter === "review",
            },
            { label: `All ${snapshots.length}`, value: "all", active: filter === "all" },
            { label: `Done ${progress.done}`, value: "done" },
          ]}
        />
      </div>
      <div data-diff-nav data-current={selectedId} data-filter={filter} class={filteredList}>
        {snapshots.map((snap): HtmlEscapedString | Promise<HtmlEscapedString> => (
          <FilmItem
            key={snap.id}
            project={project}
            build={build}
            snap={snap}
            active={selectedId === snap.id}
          />
        ))}
      </div>
    </aside>
  );
}
