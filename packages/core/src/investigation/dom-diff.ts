/** Conservative comparison of bounded replay DOM evidence. No cause is inferred. */
export interface ReplayNode {
  path: string;
  tag: string;
  id?: string;
  attributes: Record<string, string>;
  style: Record<string, string>;
  bounds: { x: number; y: number; width: number; height: number } | null;
}

export interface ReplayDom {
  nodes: ReplayNode[];
  truncated: boolean;
  fingerprint: string | null;
}

export type DomObservation =
  | { kind: "added" | "removed"; path: string; tag: string }
  | {
      kind: "attribute" | "style";
      path: string;
      name: string;
      before: string | null;
      after: string | null;
    }
  | { kind: "bounds"; path: string; before: ReplayNode["bounds"]; after: ReplayNode["bounds"] };

export interface DomComparison {
  observations: DomObservation[];
  matched: number;
  unmatchedBefore: number;
  unmatchedAfter: number;
  partial: boolean;
}

function uniqueIds(nodes: ReplayNode[]): Map<string, ReplayNode> {
  const counts = new Map<string, number>();
  for (const node of nodes) if (node.id) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
  return new Map(
    nodes
      .filter((node) => node.id && counts.get(node.id) === 1)
      .map((node) => [node.id ?? "", node]),
  );
}

function changes(
  kind: "attribute" | "style",
  path: string,
  before: Record<string, string>,
  after: Record<string, string>,
): DomObservation[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .toSorted()
    .filter((name) => before[name] !== after[name])
    .map((name) => ({
      kind,
      path,
      name,
      before: before[name] ?? null,
      after: after[name] ?? null,
    }));
}

/** Match only unique IDs or the same structural path and tag; duplicate IDs are ambiguous. */
// oxlint-disable-next-line eslint/max-statements -- matching, observations and coverage form one pass
export function compareReplayDom(before: ReplayDom, after: ReplayDom): DomComparison {
  const oldIds = uniqueIds(before.nodes);
  const newIds = uniqueIds(after.nodes);
  const newPaths = new Map(after.nodes.map((node) => [node.path, node]));
  const used = new Set<ReplayNode>();
  const observations: DomObservation[] = [];
  let matched = 0;
  for (const old of before.nodes) {
    const candidate = old.id && oldIds.get(old.id) === old && newIds.get(old.id);
    const byPath = newPaths.get(old.path);
    const current = candidate ?? (byPath?.tag === old.tag && !old.id && !byPath.id ? byPath : null);
    if (!current || current.tag !== old.tag || used.has(current)) {
      observations.push({ kind: "removed", path: old.path, tag: old.tag });
      continue;
    }
    used.add(current);
    matched += 1;
    observations.push(
      ...changes("attribute", current.path, old.attributes, current.attributes),
      ...changes("style", current.path, old.style, current.style),
    );
    if (JSON.stringify(old.bounds) !== JSON.stringify(current.bounds)) {
      observations.push({
        kind: "bounds",
        path: current.path,
        before: old.bounds,
        after: current.bounds,
      });
    }
  }
  for (const node of after.nodes)
    if (!used.has(node)) observations.push({ kind: "added", path: node.path, tag: node.tag });
  return {
    observations,
    matched,
    unmatchedBefore: before.nodes.length - matched,
    unmatchedAfter: after.nodes.length - matched,
    partial: before.truncated || after.truncated,
  };
}
