/** Per-component design link resolution: manual mappings over story-declared URLs. */
import type { DesignLink } from "../schema/design.ts";

/** Last observed health of a design credential. */
export type DesignCredentialStatus = "unknown" | "ok" | "unauthorized" | "forbidden";

/** Where a component's resolved design link came from. */
export type DesignSource = "manual" | "story";

/** The design link(s) a story file resolves to. */
export interface DesignResolution {
  /** One URL, or the distinct set when states of the file disagree. */
  urls: string[];
  source: DesignSource;
}

/** Story-file key: path without a leading `./`, so index and manual entries compare equal. */
export function normalizeImportPath(path: string): string {
  return path.trim().replace(/^(?:\.\/)+/u, "");
}

/**
 * Resolve design links per component (story file). Precedence: manual mapping
 * > story parameters (`storyshelf.figma` over `design`, already merged at
 * capture). States of one file are deduped; if they disagree the distinct set
 * is returned rather than guessing. Files with no link are absent.
 */
export function resolveDesigns(
  manual: readonly Pick<DesignLink, "importPath" | "url">[],
  snapshots: readonly { storyImportPath: string | null; designUrl?: string | null }[],
): Map<string, DesignResolution> {
  const resolved = storyDesigns(snapshots);
  for (const link of manual) {
    if (link.importPath) {
      resolved.set(normalizeImportPath(link.importPath), { urls: [link.url], source: "manual" });
    }
  }
  return resolved;
}

/** Distinct story-declared URLs per file. */
function storyDesigns(
  snapshots: readonly { storyImportPath: string | null; designUrl?: string | null }[],
): Map<string, DesignResolution> {
  const resolved = new Map<string, DesignResolution>();
  for (const snapshot of snapshots) {
    const key = snapshot.storyImportPath ? normalizeImportPath(snapshot.storyImportPath) : "";
    if (!key || !snapshot.designUrl) continue;
    const urls = resolved.get(key)?.urls ?? [];
    if (!urls.includes(snapshot.designUrl)) urls.push(snapshot.designUrl);
    resolved.set(key, { urls, source: "story" });
  }
  return resolved;
}
