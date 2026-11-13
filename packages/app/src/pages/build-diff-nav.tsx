import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import { Segmented, Thumbnail, statusTone } from "../ui/components.tsx";
import { css } from "../ui/css.ts";
import {
  filmGroup,
  filmGroupHead,
  filmItem,
  filmItemActive,
  filmStatus,
  filmTitle,
  filmstrip,
  filmstripHead,
  filmstripList,
  statusDots,
} from "../ui/styles/review-layout.ts";
import { a11yBaselineShaOf, a11yCarrierOf, a11yFindingsOf } from "./a11y-violations.tsx";
import {
  diffPercent,
  groupSnapshots,
  isOpenGroup,
  reviewProgress,
  snapshotImageUrl,
  snapshotPageUrl,
  type SnapshotGroup,
} from "./build-diff-model.ts";
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
  &[data-filter="a11y"] [data-snapshot-link]:not([data-a11y]):not([aria-current="true"]) {
    display: none;
  }
  &[data-filter="review"]
    section:not(:has([data-status="new"], [data-status="changed"], [aria-current="true"])),
  &[data-filter="a11y"] section:not(:has([data-a11y], [aria-current="true"])),
  &[data-filter="done"]
    section:not(:has([data-status="approved"], [data-status="rejected"], [aria-current="true"])) {
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
  group: SnapshotGroup;
  active: boolean;
  multiBrowser: boolean;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, group, active, multiBrowser } = props;
  const snap = group.representative;
  const url = snapshotPageUrl(project, build, snap.id);
  const percent = diffPercent(snap);
  const carrier = a11yCarrierOf(snap, group.members);
  const a11yCount = a11yFindingsOf(carrier).length;
  const mode = group.modeKey === "desktop" ? "" : ` · ${group.modeKey}`;
  const decided = snap.status === "approved" || snap.status === "rejected";
  return (
    <a
      href={url}
      class={active ? filmItemActive : filmItem}
      data-snapshot-link
      data-snapshot-id={snap.id}
      data-status={isOpenGroup(group) ? "changed" : snap.status}
      data-a11y={a11yCount > 0 ? "" : undefined}
      aria-current={active ? "true" : undefined}
      hx-get={url}
      hx-target="body"
      hx-push-url="true"
    >
      <Thumbnail src={snapshotImageUrl(project, build, snap, "image")} alt="" placeholder="…" />
      <span class={filmTitle} title={`${snap.storyTitle} / ${snap.storyName}`}>
        {snap.storyName}
        {mode}
        {multiBrowser && group.members.length > 1 ? ` · ${group.members.length} browsers` : ""}
      </span>
      <span class={filmStatus}>
        {a11yCount > 0 ? `a11y ${a11yCount}${a11yOrigin(carrier, multiBrowser)} ` : ""}
        {decided ? "✓ " : ""}
        <span class={statusDots[statusTone(snap.status)]} aria-hidden="true" />
        <span class="visually-hidden">{snap.status}</span>
        {percent ?? ""}
      </span>
    </a>
  );
}

/** Where a filmstrip item's findings were measured: "(chromium)" when the build has several browsers, or "(baseline abc1234)" when inherited. */
function a11yOrigin(
  carrier: Pick<Snapshot, "a11yViolations" | "browser">,
  multiBrowser: boolean,
): string {
  const sha = a11yBaselineShaOf(carrier);
  if (sha !== undefined) {
    return ` (baseline ${sha})`;
  }
  return multiBrowser && carrier.browser ? ` (${carrier.browser})` : "";
}

function ComponentGroup(props: {
  title: string;
  list: SnapshotGroup[];
  project: Project;
  build: Build;
  selectedId?: string;
  multiBrowser: boolean;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { title, list, project, build, selectedId, multiBrowser } = props;
  return (
    <section class={filmGroup}>
      <h3 class={filmGroupHead}>
        <span>{title}</span>
        <span>{list.length}</span>
      </h3>
      {list.map((group): HtmlEscapedString | Promise<HtmlEscapedString> => (
        <FilmItem
          key={group.key}
          project={project}
          build={build}
          group={group}
          multiBrowser={multiBrowser}
          active={group.members.some((snap) => snap.id === selectedId)}
        />
      ))}
    </section>
  );
}

/** Groups per component title, in list order (the model sorts by title). */
function groupByComponent(groups: SnapshotGroup[]): [string, SnapshotGroup[]][] {
  const byTitle = new Map<string, SnapshotGroup[]>();
  for (const group of groups) {
    const title = group.representative.storyTitle;
    byTitle.set(title, [...(byTitle.get(title) ?? []), group]);
  }
  return [...byTitle.entries()];
}

/** Left filmstrip: filter chips plus a thumbnail per story/mode (browsers share one entry). */
export function DiffNav(props: DiffNavProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, snapshots, selectedId } = props;
  const groups = groupSnapshots(snapshots);
  const multiBrowser = new Set(snapshots.map((snap) => snap.browser ?? "chromium")).size > 1;
  const components = groupByComponent(groups);
  const progress = reviewProgress(snapshots);
  const filter = progress.pending > 0 ? "review" : "all";
  const withA11y = groups.filter(
    (group) => a11yFindingsOf(a11yCarrierOf(group.representative, group.members)).length > 0,
  ).length;
  return (
    <>
      <a class="skip-link" href="#snapshot-heading" data-skip-to-comparison>
        Skip to comparison
      </a>
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
              { label: `All ${groups.length}`, value: "all", active: filter === "all" },
              { label: `Done ${progress.done}`, value: "done" },
              ...(withA11y > 0 ? [{ label: `A11y ${withA11y}`, value: "a11y" }] : []),
            ]}
          />
        </div>
        <div data-diff-nav data-current={selectedId} data-filter={filter} class={filteredList}>
          {components.map(([title, list]): HtmlEscapedString | Promise<HtmlEscapedString> => (
            <ComponentGroup
              key={title}
              title={title}
              list={list}
              project={project}
              build={build}
              selectedId={selectedId}
              multiBrowser={multiBrowser}
            />
          ))}
        </div>
      </aside>
    </>
  );
}
