import { readFileSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";

/** CPU and memory actually available to this process (container limits included). */
export interface HostResources {
  /** Fractional vCPUs: a cgroup quota of 0.5 CPU reports `0.5`. */
  cpus: number;
  memoryBytes: number;
}

const MB = 1024 * 1024;
/** Headroom for Node, the server and Chromium's browser process. */
const BASE_MEMORY_MB = 512;
/** Typical cost of one rendering page. */
const PAGE_MEMORY_MB = 300;
const MAX_PAGES = 4;
/** Ceiling for the adaptive controller, in Chromium-page slots. */
const MAX_ADAPTIVE_PAGES = 8;

/**
 * Detect the CPU and memory budget. Container limits win over the host's: a
 * 0.5 vCPU / 1 GB container on a large machine must be sized as 0.5 / 1 GB.
 */
export function detectResources(): HostResources {
  const cpus = Math.min(availableParallelism(), cgroupCpus() ?? Infinity);
  const constrained =
    typeof process.constrainedMemory === "function" ? process.constrainedMemory() : 0;
  const memoryBytes = constrained > 0 && constrained < totalmem() ? constrained : totalmem();
  return { cpus, memoryBytes };
}

/**
 * Cost of one page in Chromium-page slots. Firefox and WebKit pages cost about twice a Chromium
 * page in CPU time (ray.run cross-browser benchmarks: Firefox +71%, WebKit +60%; some Playwright
 * reports show WebKit worse), so they get half the page budget. Takes a capture target too.
 */
export function engineWeight(browser?: string): number {
  // A target is `<engine>[@<name>]`; the engine decides the page cost.
  const engine = browser?.split("@")[0];
  return engine === "firefox" || engine === "webkit" ? 2 : 1;
}

/**
 * Pages to render at once: no more than the CPUs (extra pages only slow each
 * other down and trip timeouts) and no more than memory allows. A heavier engine
 * (see {@link engineWeight}) spends the same budget on fewer pages.
 */
export function recommendedPageConcurrency(
  resources: HostResources = detectResources(),
  browser?: string,
): number {
  const budget = Math.min(Math.ceil(resources.cpus), memoryPages(resources), MAX_PAGES);
  return Math.max(1, Math.floor(budget / engineWeight(browser)));
}

/**
 * Most pages the adaptive controller may reach: memory is a hard limit, but CPU is only a
 * starting point (latency tells us when it is saturated), so allow up to twice the CPUs.
 */
export function maxPageConcurrency(
  resources: HostResources = detectResources(),
  browser?: string,
): number {
  const budget = Math.min(
    Math.ceil(resources.cpus) * 2,
    memoryPages(resources),
    MAX_ADAPTIVE_PAGES,
  );
  return Math.max(
    recommendedPageConcurrency(resources, browser),
    Math.floor(budget / engineWeight(browser)),
  );
}

function memoryPages(resources: HostResources): number {
  return Math.floor((resources.memoryBytes / MB - BASE_MEMORY_MB) / PAGE_MEMORY_MB);
}

/** Builds to capture at once: each launches its own browser, so only on roomy hosts. */
export function recommendedBuildConcurrency(resources: HostResources = detectResources()): number {
  return resources.cpus >= 2 && resources.memoryBytes >= 3 * 1024 * MB ? 2 : 1;
}

/** Playwright's 30 s default assumes a full CPU; starved containers parse the Storybook bundle slower. */
export function recommendedNavigationTimeoutMs(
  resources: HostResources = detectResources(),
): number {
  if (resources.cpus < 1) return 90_000;
  if (resources.cpus < 2) return 60_000;
  return 30_000;
}

/** Captures between browser restarts: Chromium grows slowly over a long run, so recycle it. */
export const DEFAULT_RECYCLE_BROWSER_EVERY = 150;

/** Loggable summary of the host budget and the capture settings derived from it. */
export function describeSizing(settings: {
  browser?: string;
  concurrency?: number;
  navigationTimeoutMs?: number;
  recycleBrowserEvery?: number;
}): Record<string, number> {
  const resources = detectResources();
  return {
    cpus: Math.round(resources.cpus * 100) / 100,
    memoryMb: Math.round(resources.memoryBytes / MB),
    pages: settings.concurrency ?? recommendedPageConcurrency(resources, settings.browser),
    maxPages: settings.concurrency ?? maxPageConcurrency(resources, settings.browser),
    navigationTimeoutMs: settings.navigationTimeoutMs ?? recommendedNavigationTimeoutMs(resources),
    recycleBrowserEvery: settings.recycleBrowserEvery ?? DEFAULT_RECYCLE_BROWSER_EVERY,
  };
}

/** What capture will use on this host: detected resources and the effective concurrency. */
export interface CaptureHostSummary {
  cpus: number;
  memoryMb: number;
  /** Builds captured at once, and whether that was sized from the hardware or configured. */
  builds: { value: number; auto: boolean };
  /** Pages per build when the runner is not pinned: where it starts and the most it may reach (Chromium). */
  pages: { start: number; max: number };
}

/** Summarise the host budget and effective capture concurrency, for the System page. */
export function describeCaptureHost(
  configuredBuilds?: number,
  resources: HostResources = detectResources(),
): CaptureHostSummary {
  return {
    cpus: Math.round(resources.cpus * 100) / 100,
    memoryMb: Math.round(resources.memoryBytes / MB),
    builds: {
      value: configuredBuilds ?? recommendedBuildConcurrency(resources),
      auto: configuredBuilds === undefined,
    },
    pages: { start: recommendedPageConcurrency(resources), max: maxPageConcurrency(resources) },
  };
}

function cgroupCpus(): number | null {
  return cgroupV2Cpus() ?? cgroupV1Cpus();
}

function cgroupV2Cpus(): number | null {
  const [quota, period] = readText("/sys/fs/cgroup/cpu.max")?.trim().split(/\s+/u) ?? [];
  return quotaToCpus(quota, period);
}

function cgroupV1Cpus(): number | null {
  const quota = readText("/sys/fs/cgroup/cpu/cpu.cfs_quota_us")?.trim();
  const period = readText("/sys/fs/cgroup/cpu/cpu.cfs_period_us")?.trim();
  return quotaToCpus(quota, period);
}

function quotaToCpus(quota: string | undefined, period: string | undefined): number | null {
  const q = Number(quota);
  const p = Number(period);
  return Number.isFinite(q) && q > 0 && Number.isFinite(p) && p > 0 ? q / p : null;
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
