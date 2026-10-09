/** Project-health evidence: build-level aggregates only (no screenshots). */
import type { BuiltEvidence } from "./evidence.ts";
import { type EvidenceLimits, resolveLimits } from "./limits.ts";
import { capBytes, field } from "./text.ts";

/** One build in the window, summarized. */
export interface BuildSummary {
  createdAt: string;
  gitBranch: string;
  status: string;
  snapshotCount: number;
  changedCount: number;
  approvedCount: number;
  rejectedCount: number;
}

/** Input for the health digest (all pre-loaded). */
export interface HealthEvidenceInput {
  projectName: string;
  window: string;
  builds: BuildSummary[];
  /** Stories that changed most often in the window. */
  churnyStories: { key: string; changedBuilds: number }[];
  limits?: Partial<EvidenceLimits>;
}

/** Assemble health evidence deterministically. */
export function buildHealthEvidence(input: HealthEvidenceInput): BuiltEvidence {
  const limits: EvidenceLimits = resolveLimits(input.limits);
  const builds = input.builds.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lines = [
    "<evidence>",
    `PROJECT ${field(input.projectName)} WINDOW ${field(input.window, 20)} BUILDS ${builds.length}`,
    ...builds
      .slice(-limits.maxSnapshots)
      .map(
        (b) =>
          `BUILD day=${b.createdAt.slice(0, 10)} branch=${field(b.gitBranch, 80)} status=${field(b.status, 30)} total=${b.snapshotCount} changed=${b.changedCount} approved=${b.approvedCount} rejected=${b.rejectedCount}`,
      ),
    ...input.churnyStories
      .slice(0, 20)
      .map((s) => `CHURN key=${field(s.key)} changedBuilds=${s.changedBuilds}`),
    "</evidence>",
  ];
  return {
    text: capBytes(lines, limits.maxTextBytes),
    images: [],
    listed: builds.length,
    omitted: 0,
  };
}
