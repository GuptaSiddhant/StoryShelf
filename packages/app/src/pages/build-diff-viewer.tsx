import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { HtmlEscapedString } from "hono/utils/html";
import type { BaselineReference, DefaultComparison } from "../routers/baseline-reference.ts";
import {
  Badge,
  Button,
  CompareStage,
  HStack,
  Segmented,
  VStack,
  formatSize,
  sizesDiffer,
  statusTone,
  type ImageSize,
} from "../ui/components.tsx";
import { viewerHead, viewerMeta, viewerTitle } from "../ui/styles/review-layout.ts";
import { A11yViolationsNotice, a11yCarrierOf } from "./a11y-violations.tsx";
import { DefaultComparisonView } from "./build-diff-default.tsx";
import { EnvironmentChangeSnapshotNotice } from "./build-diff-environment.tsx";
import {
  designSources,
  diffPercent,
  snapshotImageUrl,
  snapshotPageUrl,
  snapshotVariant,
} from "./build-diff-model.ts";
import { BaselineReferenceLine, ComparisonSources } from "./build-diff-reference.tsx";
import { StaleSnapshotNotice } from "./build-diff-stale.tsx";
import { UnstableBadge, UnstableNotice } from "./build-diff-unstable.tsx";
import { LinkedUsage, type LinkedUsageItem } from "./build-diff-usage.tsx";
import { DesignReferences, DesignStrip, type DesignItem } from "./design-links.tsx";
/** Viewer props for the selected snapshot. */
export interface DiffViewerProps {
  project: Project;
  build: Build;
  selected: Snapshot;
  /** The selected story/mode's snapshots on every engine (browser tabs when more than one). */
  siblings?: Snapshot[];
  hasBaseline: Record<string, boolean>;
  reference?: BaselineReference;
  defaultComparison?: DefaultComparison | null;
  /** Set when the baseline changed after this snapshot's diff was computed. */
  drifted?: "stale" | "removed";
  /** Linked packages the story uses (provenance badges + upstream deep links). */
  usage?: LinkedUsageItem[];
  /** Resolved design links of the story's component (open-in-Figma + stale/deleted notices). */
  design?: DesignItem[];
  publishedBaseDomain?: string;
  /** Natural size of the current screenshot (from its PNG header), when known. */
  currentSize?: ImageSize | null;
}

/** The baseline image's natural size, when the reference knows it. */
function baselineSizeOf(props: DiffViewerProps): ImageSize | null {
  return props.reference?.kind === "known" ? (props.reference.imageSize ?? null) : null;
}

/** Why a snapshot has no diff image, phrased for the diff mode. */
function diffEmptyText(status: string, sizes: SizeChange | null): string {
  if (sizes) {
    return `No pixel diff: the images are different sizes (${formatSize(sizes.from)} → ${formatSize(sizes.to)}), so they cannot be compared pixel for pixel. Use side by side, swipe or onion skin.`;
  }
  return status === "unchanged" || status === "approved"
    ? "No diff — within threshold"
    : "No diff image for this snapshot.";
}

/** The baseline and current sizes when they differ. */
interface SizeChange {
  from: ImageSize;
  to: ImageSize;
}

function sizeChangeOf(props: DiffViewerProps): SizeChange | null {
  const from = baselineSizeOf(props);
  const to = props.currentSize ?? null;
  return from && to && sizesDiffer(from, to) ? { from, to } : null;
}

/** "100×100 → 120×100" and a "sizes differ" badge, instead of a meaningless 100% diff. */
function SizeChangeNote(props: {
  change: SizeChange;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { from, to } = props.change;
  return (
    <HStack gap="sm">
      <span class="mono">
        {formatSize(from)} → {formatSize(to)}
      </span>
      <Badge tone="warning">sizes differ</Badge>
    </HStack>
  );
}

/** Pixel count and share of the diff; omitted when the sizes differ (every pixel would count). */
function DiffFigures(props: {
  selected: Snapshot;
  sizeChanged: boolean;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const { selected, sizeChanged } = props;
  if (sizeChanged) return null;
  const percent = diffPercent(selected);
  return (
    <>
      {selected.diffPixels === null || selected.diffPixels === undefined ? null : (
        <span class="mono">{selected.diffPixels} px</span>
      )}
      {percent ? <span class="mono">{percent}</span> : null}
    </>
  );
}

/** What the snapshot was compared with, and whether the sizes changed: one quiet row. */
function ComparisonLine(
  props: DiffViewerProps,
): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const change = sizeChangeOf(props);
  if (!props.reference && !change) return null;
  return (
    <HStack justify="between" wrap>
      {props.reference ? (
        <BaselineReferenceLine reference={props.reference} projectSlug={props.project.slug} />
      ) : (
        <span />
      )}
      {change ? <SizeChangeNote change={change} /> : null}
    </HStack>
  );
}

/** Browser tabs (one link per engine) when the story/mode was captured on several. */
function BrowserTabs(props: {
  project: Project;
  build: Build;
  selected: Snapshot;
  siblings: Snapshot[];
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const { project, build, selected, siblings } = props;
  if (siblings.length < 2) return null;
  return (
    <Segmented
      label="Browser"
      data-browser-tabs
      items={siblings.map((snap) => ({
        label: `${snap.browser ?? "chromium"} · ${snap.status}`,
        value: snap.id,
        href: snapshotPageUrl(project, build, snap.id),
        active: snap.id === selected.id,
      }))}
    />
  );
}

/** Link to the story file's component page, anchored at the story. */
function ViewComponentButton(props: {
  project: Project;
  selected: Snapshot;
  base?: string;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const { project, selected, base } = props;
  if (!selected.storyImportPath) return null;
  const urls = createUrlBuilder("/", base);
  return (
    <Button
      variant="ghost"
      size="sm"
      href={`${urls.component(project.slug, selected.storyImportPath, { build: selected.buildId })}#${selected.storyId}`}
    >
      View in Library
    </Button>
  );
}

/** Story heading plus the comparison stage for the selected snapshot. */
export function DiffViewer(props: DiffViewerProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selected, drifted, usage, design, publishedBaseDomain } = props;
  const siblings = props.siblings ?? [selected];
  const sizeChanged = sizeChangeOf(props) !== null;
  return (
    <VStack>
      <div class={viewerHead}>
        <h2 class={viewerTitle} id="snapshot-heading" tabindex={-1} data-focus-heading>
          {selected.storyTitle} / {selected.storyName}
        </h2>
        <p class={viewerMeta}>
          <Badge tone={statusTone(selected.status)} icon>
            {selected.status}
          </Badge>
          <UnstableBadge snapshot={selected} />
          <span>
            {snapshotVariant(selected)} · {selected.viewportWidth}×{selected.viewportHeight}
          </span>
          <DiffFigures selected={selected} sizeChanged={sizeChanged} />
          <ViewComponentButton project={project} selected={selected} base={publishedBaseDomain} />
        </p>
      </div>
      <ComparisonLine {...props} />
      <BrowserTabs project={project} build={build} selected={selected} siblings={siblings} />
      {drifted ? <StaleSnapshotNotice status={drifted} /> : null}
      <EnvironmentChangeSnapshotNotice snapshot={selected} migrated={build.isDefault} />
      <UnstableNotice snapshot={selected} />
      <A11yViolationsNotice snapshot={a11yCarrierOf(selected, siblings)} />
      {usage && usage.length > 0 ? (
        <LinkedUsage usage={usage} publishedBaseDomain={publishedBaseDomain} />
      ) : null}
      {design && design.length > 0 ? <DesignStrip items={design} /> : null}
      <PrimaryComparison {...props} />
      <SecondaryComparison {...props} />
      {design && design.length > 0 ? <DesignReferences items={design} /> : null}
    </VStack>
  );
}

function SecondaryComparison(
  props: DiffViewerProps,
): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  if (!props.defaultComparison) return null;
  return (
    <DefaultComparisonView
      {...props}
      snapshot={props.selected}
      comparison={props.defaultComparison}
    />
  );
}

function baselineUrl(props: DiffViewerProps): string | null {
  const { hasBaseline, selected, reference, project, build } = props;
  return hasBaseline[selected.id] &&
    reference?.kind !== "none" &&
    !(reference?.kind === "known" && !reference.imageAvailable) &&
    !(reference?.kind === "unavailable" && selected.baselineVersion !== null)
    ? snapshotImageUrl(project, build, selected, "baseline")
    : null;
}

function PrimaryComparison(props: DiffViewerProps): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, build, selected, reference } = props;
  const change = sizeChangeOf(props);
  const stage = (
    <CompareStage
      baselineSrc={baselineUrl(props)}
      baselineEmpty={
        reference?.kind === "unavailable" ||
        (reference?.kind === "known" && !reference.imageAvailable)
          ? "The original baseline image is unavailable."
          : undefined
      }
      currentSrc={snapshotImageUrl(project, build, selected, "image")}
      diffSrc={selected.diffPath ? snapshotImageUrl(project, build, selected, "diff") : null}
      subject={`${selected.storyTitle} / ${selected.storyName}`}
      diffEmpty={diffEmptyText(selected.status, change)}
      diffMeta={change ? undefined : (diffPercent(selected) ?? undefined)}
      baselineSize={baselineSizeOf(props)}
      currentSize={props.currentSize}
    />
  );
  return (
    <ComparisonSources
      baseline={stage}
      sources={designSources(props.design ?? [])}
      currentSrc={snapshotImageUrl(project, build, selected, "image")}
      subject={`${selected.storyTitle} / ${selected.storyName}`}
    />
  );
}
