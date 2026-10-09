/** API/UI view of an insight row (parses the stored envelope defensively). */
import type { InsightRow } from "@storyshelf/core/schema";

/** Public shape of an insight. */
export interface InsightView {
  id: string;
  kind: string;
  buildId: string | null;
  window: string | null;
  status: string;
  profile: string;
  model: string;
  promptVersion: string;
  verdict: string | null;
  summary: string | null;
  output: unknown;
  meta: unknown;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

function parseResult(raw: string | null): { output: unknown; meta: unknown } {
  if (!raw) {
    return { output: null, meta: null };
  }
  try {
    const parsed = JSON.parse(raw) as { output?: unknown; meta?: unknown };
    return { output: parsed.output ?? null, meta: parsed.meta ?? null };
  } catch {
    return { output: null, meta: null };
  }
}

/** Convert a stored row to its public view. */
export function toInsightView(row: InsightRow): InsightView {
  const { output, meta } = parseResult(row.result);
  return {
    id: row.id,
    kind: row.kind,
    buildId: row.buildId,
    window: row.windowKey,
    status: row.status,
    profile: row.profile,
    model: row.model,
    promptVersion: row.promptVersion,
    verdict: row.verdict,
    summary: row.summary,
    output,
    meta,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}
