/** Pure evidence builders: already-loaded inputs in, delimited text + images out. */
import type { AiEvidence } from "../ai.ts";
import { downscalePng } from "./downscale.ts";
import { type EvidenceLimits, resolveLimits } from "./limits.ts";
import { capBytes, field, headTail } from "./text.ts";

/** One changed (or failed) snapshot as evidence. */
export interface SnapshotEvidence {
  storyId: string;
  title: string;
  name: string;
  viewport: string;
  status: string;
  diffRatio: number | null;
  inherited: boolean;
  /** Raw play/a11y/capture log text for this snapshot, if any. */
  log?: string;
  /** Screenshot PNG, loaded by the caller (only used for the top-ranked few). */
  screenshot?: Uint8Array;
}

/** Everything the triage builder needs (all pre-loaded). */
export interface TriageEvidenceInput {
  projectName: string;
  build: {
    gitBranch: string;
    gitSha: string;
    message: string | null;
    status: string;
    snapshotCount: number;
    changedCount: number;
    approvedCount: number;
    rejectedCount: number;
    changedFiles: string[];
  };
  snapshots: SnapshotEvidence[];
  comments: { author: string; body: string }[];
  limits?: Partial<EvidenceLimits>;
}

/** Evidence plus bookkeeping the caller needs for hashing and rows. */
export interface BuiltEvidence extends AiEvidence {
  /** Snapshots listed individually / total changed. */
  listed: number;
  omitted: number;
}

/** Stable story key shown to the model and echoed back in `snapshotKey`. */
export function snapshotKey(s: Pick<SnapshotEvidence, "title" | "name" | "viewport">): string {
  return field(`${s.title}/${s.name}@${s.viewport}`, 200);
}

function rank(a: SnapshotEvidence, b: SnapshotEvidence): number {
  const failed = Number(b.status === "failed") - Number(a.status === "failed");
  return (
    failed ||
    (b.diffRatio ?? 0) - (a.diffRatio ?? 0) ||
    snapshotKey(a).localeCompare(snapshotKey(b))
  );
}

function snapshotLines(s: SnapshotEvidence, limits: EvidenceLimits): string[] {
  const ratio = s.diffRatio === null ? "n/a" : s.diffRatio.toFixed(4);
  const lines = [`SNAPSHOT key=${snapshotKey(s)} status=${field(s.status, 30)} diffRatio=${ratio}`];
  if (s.log) {
    lines.push(`  LOG: ${headTail(s.log, limits.logHeadBytes, limits.logTailBytes)}`);
  }
  return lines;
}

/** Assemble triage evidence deterministically (redacted, capped, ranked). */
export function buildTriageEvidence(input: TriageEvidenceInput): BuiltEvidence {
  const limits = resolveLimits(input.limits);
  const changed = input.snapshots.filter((s) => !s.inherited).toSorted(rank);
  const listed = changed.slice(0, limits.maxSnapshots);
  const b = input.build;
  const lines = [
    "<evidence>",
    `PROJECT ${field(input.projectName)}`,
    `BUILD branch=${field(b.gitBranch)} sha=${field(b.gitSha.slice(0, 12), 12)} status=${field(b.status, 30)}`,
    `COUNTS total=${b.snapshotCount} changed=${b.changedCount} approved=${b.approvedCount} rejected=${b.rejectedCount}`,
    `COMMIT ${field(b.message, 300)}`,
    `CHANGED_FILES (${b.changedFiles.length}): ${b.changedFiles
      .slice(0, 40)
      .map((f) => field(f, 120))
      .join(", ")}`,
    ...listed.flatMap((s) => snapshotLines(s, limits)),
    `OMITTED_SNAPSHOTS ${changed.length - listed.length}`,
    ...input.comments
      .slice(0, 10)
      .map((c) => `COMMENT ${field(c.author, 60)}: ${field(c.body, 300)}`),
    "</evidence>",
  ];
  const images = listed
    .flatMap((item) =>
      item.screenshot
        ? [
            {
              mediaType: "image/png" as const,
              data: downscalePng(item.screenshot, limits.imageMaxEdge),
              label: snapshotKey(item),
            },
          ]
        : [],
    )
    .slice(0, limits.maxImages);
  return {
    text: capBytes(lines, limits.maxTextBytes),
    images,
    listed: listed.length,
    omitted: changed.length - listed.length,
  };
}
