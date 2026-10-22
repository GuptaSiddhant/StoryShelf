/** Markdown of the pull-request comment, derived from the same inputs as the statuses (ADR 0014, decision 6). */
import type { DesiredStatus } from "./build-state.ts";

/** Inputs of {@link buildCommentMarkdown}. */
export interface BuildCommentInput {
  buildUrl: string;
  /** Present once the Storybook is published. */
  storybookUrl?: string | undefined;
  /** The gating statuses (`testing` or `review`), in display order. */
  gates: readonly DesiredStatus[];
  /** Present when `testing` or review is on: the snapshot totals to summarize. */
  counts?:
    | {
        snapshotCount: number;
        changedCount: number;
        approvedCount: number;
        rejectedCount: number;
      }
    | undefined;
}

const LABEL: Record<DesiredStatus["name"], string> = {
  testing: "Visual tests",
  review: "Review",
  storybook: "Storybook",
};

/** Comment body (below the idempotency marker): links to the build, the Storybook and a summary. */
export function buildCommentMarkdown(input: BuildCommentInput): string {
  const lines = [`**StoryShelf** — [View build](${input.buildUrl})`];
  for (const gate of input.gates) {
    lines.push(`- ${LABEL[gate.name]}: ${gate.description}`);
  }
  if (input.counts !== undefined && input.counts.snapshotCount > 0) {
    const { snapshotCount, changedCount, approvedCount, rejectedCount } = input.counts;
    lines.push(
      `- Snapshots: ${String(snapshotCount)} total, ${String(changedCount)} changed, ${String(approvedCount)} approved, ${String(rejectedCount)} rejected`,
    );
  }
  if (input.storybookUrl !== undefined) {
    lines.push(`- Storybook: [Open the published Storybook](${input.storybookUrl})`);
  }
  return lines.join("\n");
}
