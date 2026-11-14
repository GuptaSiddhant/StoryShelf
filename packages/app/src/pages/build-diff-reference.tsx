import { createUrlBuilder } from "@storyshelf/core/urls";
import type { HtmlEscapedString } from "hono/utils/html";
import type { BaselineReference } from "../routers/baseline-reference.ts";
import { CompareStage, Meta, RelativeTime, Segmented } from "../ui/components.tsx";
import type { DesignSource } from "./build-diff-model.ts";
/** "vs main", or "vs feature/x, accepted on this branch" for a branch's own baseline. */
function branchLabel(reference: { branch: string; defaultBranch: boolean }): string {
  return reference.defaultBranch
    ? `vs ${reference.branch}`
    : `vs ${reference.branch}, accepted on this branch`;
}

/**
 * One quiet line naming what the snapshot was compared with: "vs main · abc1234 · updated 2 h ago".
 * Not a live region, so stepping through snapshots does not re-announce it. The commit links to the
 * reference build (its page has the full id) and the time shows the exact timestamp on hover.
 */
export function BaselineReferenceLine(props: {
  reference: BaselineReference;
  projectSlug: string;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { reference, projectSlug } = props;
  if (reference.kind === "none") {
    return <Meta>No baseline at capture: this was a new comparison.</Meta>;
  }
  if (reference.kind === "unavailable") {
    return (
      <Meta>
        Baseline reference unavailable: it changed after this diff, so an image shown may be the
        current baseline rather than the one compared.
      </Meta>
    );
  }
  const build = reference.build;
  return (
    <Meta>
      {branchLabel(reference)} ·{" "}
      {build ? (
        <a
          class="mono"
          href={createUrlBuilder("/").build(projectSlug, build.id)}
          title={`Reference build ${build.id}`}
        >
          {build.gitSha.slice(0, 7)}
        </a>
      ) : (
        "reference build unknown"
      )}{" "}
      · updated <RelativeTime value={reference.updatedAt} />
    </Meta>
  );
}

/** What the Design source is, shown under its controls. */
const DESIGN_NOTE = "Design reference: not a test. Scaled to the screenshot’s width.";

/**
 * The comparison stage with a source switch. The baseline stage is always there; each cached design
 * render adds a stage (hidden until chosen) that compares the screenshot with the design using the
 * same side-by-side, swipe and onion tools. A reference only: no diff, score or verdict. Without a
 * render, only the baseline stage is rendered.
 */
export function ComparisonSources(props: {
  /** The baseline comparison stage. */
  baseline: HtmlEscapedString | Promise<HtmlEscapedString>;
  sources: DesignSource[];
  currentSrc: string;
  /** Accessible description shared by the images, e.g. "Button / Primary". */
  subject: string;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { baseline, sources, currentSrc, subject } = props;
  if (sources.length === 0) return baseline;
  return (
    <div data-compare-sources>
      <Segmented
        label="Compare against"
        data-compare-source-switch
        items={[
          { label: "Baseline", value: "baseline", active: true },
          ...sources.map((source) => ({ label: source.label, value: source.value })),
        ]}
      />
      <div data-compare-source="baseline">{baseline}</div>
      {sources.map((source) => (
        <div key={source.value} data-compare-source={source.value} hidden>
          <CompareStage
            variant="design"
            baselineLabel={source.name ? `${source.providerName} · ${source.name}` : "Design"}
            baselineSrc={source.src}
            currentSrc={currentSrc}
            diffSrc={null}
            subject={subject}
            note={DESIGN_NOTE}
          />
        </div>
      ))}
    </div>
  );
}
