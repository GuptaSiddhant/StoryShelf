import type { HtmlEscapedString } from "hono/utils/html";
import type { BaselineReference } from "../routers/baseline-reference.ts";
import { Alert, CompareStage, Segmented } from "../ui/components.tsx";
import type { DesignSource } from "./build-diff-model.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HTML or a promise */
export function BaselineReferenceNotice(props: {
  reference: BaselineReference;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const reference = props.reference;
  if (reference.kind === "none")
    return (
      <Alert tone="info" title="No baseline at capture">
        This was a new comparison; no baseline existed when it was captured.
      </Alert>
    );
  if (reference.kind === "unavailable")
    return (
      <Alert tone="warning" title="Baseline reference unavailable">
        The original baseline details or image are unavailable or have changed since this diff was
        computed. For older records, any image shown may be the current baseline rather than the one
        used for the diff.
      </Alert>
    );
  return (
    <Alert tone="info" title="Comparison baseline">
      {reference.defaultBranch ? "Default branch" : "Accepted branch"}: {reference.branch}. Baseline
      updated {reference.updatedAt}.
      {reference.imageAvailable ? "" : " The baseline image is unavailable."}
      {reference.build
        ? ` Reference build ${reference.build.id}, commit ${reference.build.gitSha.slice(0, 7)}.`
        : " Reference build and commit are unavailable."}
    </Alert>
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
