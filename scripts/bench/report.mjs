/** The short text table printed after the JSON summary (issue #853). */
import { table } from "./stats.mjs";

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

export function render(summary) {
  const { storage, capture, serving, pages } = summary;
  const parts = [];
  parts.push(
    "Storage (after capture)",
    table(
      ["upload", "total", "objects", "storybook files", "build zips", "screenshots"],
      Object.entries(storage).map(([name, s]) => [
        name,
        kb(s.total.bytes),
        s.total.objects,
        `${kb(s.storybookFiles.bytes)} / ${s.storybookFiles.objects}`,
        `${kb(s.buildZips.bytes)} / ${s.buildZips.objects}`,
        `${kb(s.screenshots.bytes)} / ${s.screenshots.objects}`,
      ]),
    ),
    "",
    "Capture (ms; spans are the orchestrator's timed() sums)",
    table(
      ["build", "wall", "snapshots", "render/shot", "extract", "persist", "db queries", "db ms"],
      Object.entries(capture).map(([name, c]) => [
        name,
        c.wallMs,
        c.snapshots,
        c.renderMsPerScreenshot,
        c.spansMs["capture.extract"],
        c.spansMs["capture.persist"],
        c.db.queries,
        c.db.totalMs,
      ]),
    ),
    "",
    "Slowest queries (first build)",
    ...capture.first.db.slowest.map((q) => `  ${q.ms} ms  ${q.call}`),
    "",
    "Published serving (/_/<buildId>/)",
    table(
      ["page", "wall ms", "storage calls", "by method"],
      Object.entries(serving).map(([name, s]) => [
        name,
        s.wallMs,
        s.storageCalls,
        JSON.stringify(s.byMethod),
      ]),
    ),
    "",
    "App pages",
    table(
      ["page", "status", "bytes", "ms"],
      Object.entries(pages).map(([name, p]) => [name, p.status, p.bytes, p.ms]),
    ),
  );
  return parts.join("\n");
}
