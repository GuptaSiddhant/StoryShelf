/** Whether a capture child is worth forking on this host (ADR 0031 phase 3 fallback rules). */

/** What the decision looks at. */
export interface ForkHost {
  cpus: number;
  memoryBytes: number;
  /** `child_process.fork` exists and works in this runtime. */
  canFork: boolean;
}

/** Outcome: fork a child, or stay in-process and say why. */
export type ForkDecision = { mode: "fork" } | { mode: "in-process"; reason: string };

/** Smallest host that still gains from a second process: below this the child only costs memory. */
export const FORK_MIN_CPUS = 2;
export const FORK_MIN_MEMORY_BYTES = 2 * 1024 ** 3;

/** Pick the capture process model for a host. */
export function decideCaptureProcess(host: ForkHost): ForkDecision {
  if (!host.canFork) {
    return { mode: "in-process", reason: "child processes are unavailable in this runtime" };
  }
  if (host.cpus < FORK_MIN_CPUS) {
    return { mode: "in-process", reason: `only ${host.cpus} CPU available` };
  }
  if (host.memoryBytes < FORK_MIN_MEMORY_BYTES) {
    return { mode: "in-process", reason: "not enough memory for a second process" };
  }
  return { mode: "fork" };
}
