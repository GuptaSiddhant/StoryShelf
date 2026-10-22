/** The snapshot layer of the library: what `testing` adds on top of the catalog (ADR 0006, decision 9). */
import type { Project, Snapshot } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { HtmlEscapedString } from "hono/utils/html";
import {
  loadDesignResolutions,
  designUrlsFor,
  loadDesignPreviews,
  loadProjectDesignLinks,
  providerNameFor,
} from "../routers/design.handlers.ts";
import { getStore } from "../store.ts";
import { Badge, Button, HStack, SectionTitle, statusTone } from "../ui/components.tsx";
import { css } from "../ui/css.ts";
import {
  diffPaneImg,
  snapshotCard,
  snapshotCardBody,
  snapshotCardHead,
  snapshotCardMeta,
  snapshotGrid,
} from "../ui/styles/review.ts";
import { A11yViolationsDetails } from "./a11y-violations.tsx";
import { groupSnapshots } from "./build-diff-model.ts";
import { DesignButtons, type DesignPreviewInfo, type ProjectDesignLink } from "./design-links.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

type Rendered = HtmlEscapedString | Promise<HtmlEscapedString>;

/** Snapshot image with library height cap, extending the shared diff pane image. */
const snapshotImg = css`
  /* snapshot-img */
  ${diffPaneImg}
  max-height: 240px;
  object-fit: contain;
`;

/** Design data of the library: per-snapshot component links plus project-level file links. */
export interface LibraryDesign {
  bySnapshot: Map<string, string[]>;
  previews: Map<string, DesignPreviewInfo>;
  projectLinks: ProjectDesignLink[];
}

/** Snapshots and design links of the build, by story; layered onto the catalog's stories. */
export interface SnapshotLayer {
  /** One snapshot per story and mode (the primary engine's; other browsers are review detail). */
  byStory: Map<string, Snapshot[]>;
  design: LibraryDesign;
  /** Whether the build has more than one viewport (so the cards name theirs). */
  multipleViewports: boolean;
}

const NO_DESIGN: LibraryDesign = { bySnapshot: new Map(), previews: new Map(), projectLinks: [] };

/** The layer for a build's snapshots; design data that cannot be loaded leaves the library plain. */
export async function loadSnapshotLayer(
  project: Project,
  snapshots: Snapshot[],
): Promise<SnapshotLayer> {
  const primary = groupSnapshots(snapshots).map((group) => group.primary);
  const design = await loadLibraryDesign(project, primary).catch(() => NO_DESIGN);
  return {
    byStory: Map.groupBy(primary, (snap) => snap.storyId),
    design,
    multipleViewports: new Set(primary.map((snap) => snap.viewportName)).size > 1,
  };
}

async function loadLibraryDesign(project: Project, snapshots: Snapshot[]): Promise<LibraryDesign> {
  const [resolutions, projectLinks] = await Promise.all([
    loadDesignResolutions(project, snapshots),
    loadProjectDesignLinks(project),
  ]);
  const bySnapshot = new Map(
    snapshots.map((snap) => [snap.id, designUrlsFor(resolutions, snap)] as const),
  );
  const previews = await loadDesignPreviews(project, [...bySnapshot.values()].flat());
  return { bySnapshot, previews, projectLinks };
}

/** Snapshot cards of a component's captured stories, one grid per viewport. */
export function SnapshotCards(props: {
  snapshots: Snapshot[];
  project: Project;
  buildId: string;
  layer: SnapshotLayer;
  componentHref: string | undefined;
}): Rendered {
  const byViewport = Map.groupBy(props.snapshots, (snap) => snap.viewportName);
  return (
    <>
      {[...byViewport.keys()].toSorted().map((name): Rendered => (
        <div key={name}>
          {props.layer.multipleViewports ? <SectionTitle level={3}>{name}</SectionTitle> : null}
          <div class={snapshotGrid}>
            {(byViewport.get(name) ?? [])
              .toSorted((a, b) => a.storyName.localeCompare(b.storyName))
              .map((snap) => (
                <SnapshotCardItem key={snap.id} snap={snap} {...props} />
              ))}
          </div>
        </div>
      ))}
    </>
  );
}

function SnapshotCardItem(props: {
  snap: Snapshot;
  project: Project;
  buildId: string;
  layer: SnapshotLayer;
  componentHref: string | undefined;
}): Rendered {
  const { snap, project, buildId } = props;
  return (
    <div
      class={snapshotCard}
      data-filter-item
      data-filter-text={`${snap.storyTitle} ${snap.storyName}`}
    >
      <div class={snapshotCardHead}>
        <strong>{snap.storyName}</strong>
        <span class={snapshotCardMeta}>
          <Badge tone={statusTone(snap.status)}>{snap.status}</Badge> {snap.viewportWidth}×
          {snap.viewportHeight}
        </span>
      </div>
      <div class={snapshotCardBody}>
        <img
          class={snapshotImg}
          src={`/api/v1/projects/${project.slug}/builds/${buildId}/snapshots/${snap.id}/image`}
          alt={`${snap.storyTitle} / ${snap.storyName}`}
          loading="lazy"
        />
        <A11yViolationsDetails snapshot={snap} />
        <SnapshotActions {...props} />
      </div>
    </div>
  );
}

function SnapshotActions(props: {
  snap: Snapshot;
  project: Project;
  buildId: string;
  layer: SnapshotLayer;
  componentHref: string | undefined;
}): Rendered {
  const { snap, project, buildId, layer } = props;
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  return (
    <HStack>
      <Button
        variant="secondary"
        size="sm"
        icon="columns"
        href={`${urls.buildDiff(project.slug, buildId)}?snapshot=${snap.id}`}
      >
        Review
      </Button>
      <Button
        variant="ghost"
        size="sm"
        icon="external-link"
        href={`${urls.storybookBuild(project.slug, buildId)}/?storyId=${encodeURIComponent(snap.storyId)}`}
        target="_blank"
        rel="noopener"
      >
        Preview
      </Button>
      <DesignButtons
        urls={layer.design.bySnapshot.get(snap.id) ?? []}
        providerName={providerNameFor}
        previews={layer.design.previews}
        componentHref={props.componentHref}
      />
    </HStack>
  );
}
