import { describe, expect, it } from "vite-plus/test";
import {
  annotationBatches,
  buildIdOf,
  showsNewerBuild,
  FINDINGS_LISTED,
  findingKey,
  findingsHash,
  markedHash,
  checkRunBody,
  phaseOf,
  summaryOf,
  ANNOTATIONS_PER_REQUEST,
} from "./github-check-mapper.ts";

const base = {
  context: "storyshelf/testing",
  description: "Review open: 2 changes to review",
  url: "https://shelf.example/projects/web/builds/B1",
};

describe("phaseOf: the build lifecycle", () => {
  it.each([
    [{ state: "pending", progress: "queued" }, { status: "queued" }],
    [{ state: "pending", progress: "running" }, { status: "in_progress" }],
    [{ state: "pending" }, { status: "in_progress" }],
    [{ state: "success" }, { status: "completed", conclusion: "success" }],
    [{ state: "failure" }, { status: "completed", conclusion: "failure" }],
    [{ state: "cancelled" }, { status: "completed", conclusion: "cancelled" }],
    [
      { state: "failure", informational: true },
      { status: "completed", conclusion: "neutral" },
    ],
    [
      { state: "success", informational: true },
      { status: "completed", conclusion: "success" },
    ],
  ] as const)("%j -> %j", (input, phase) => {
    expect(phaseOf(input)).toEqual(phase);
  });
});

describe("checkRunBody", () => {
  it("names the run after the context and keys it with a stable external id", () => {
    expect(checkRunBody({ ...base, state: "pending", progress: "queued" })).toEqual({
      name: "storyshelf/testing",
      external_id: "storyshelf:storyshelf/testing",
      status: "queued",
      details_url: base.url,
      output: {
        title: base.description,
        summary: `${base.description}\n\n[Open the build](${base.url})`,
      },
    });
  });

  it("leaves out the link while there is none", () => {
    const body = checkRunBody({ context: "c", state: "success", description: "ok" });
    expect(body).not.toHaveProperty("details_url");
    expect(body.output.summary).toBe("ok");
  });
});

describe("summaryOf", () => {
  it("says how many changes the annotations leave out and links to the build", () => {
    expect(summaryOf({ ...base, state: "pending", omitted: 12 })).toBe(
      `${base.description}\n\nand 12 more changed snapshots: [open the build](${base.url})`,
    );
    expect(summaryOf({ context: "c", state: "pending", description: "d", omitted: 2 })).toBe(
      "d\n\nand 2 more changed snapshots",
    );
  });
});

const annotation = (index: number) => ({
  path: "a.tsx",
  title: `t${String(index)}`,
  message: `m${String(index)}`,
  url: `https://shelf/s/${String(index)}`,
  level: "warning" as const,
});
describe("annotationBatches", () => {
  const many = Array.from({ length: 120 }, (_, at) => annotation(at));

  it("cuts 50 per request", () => {
    expect(annotationBatches(many).map((batch) => batch.length)).toEqual([50, 50, 20]);
    expect(ANNOTATIONS_PER_REQUEST).toBe(50);
  });

  it("maps a finding to the Checks API shape with the review link in the details", () => {
    expect(annotationBatches([annotation(1)])).toEqual([
      [
        {
          path: "a.tsx",
          start_line: 1,
          end_line: 1,
          annotation_level: "warning",
          title: "t1",
          message: "m1",
          raw_details: "https://shelf/s/1",
        },
      ],
    ]);
  });

  it("makes no batch for no findings", () => {
    expect(annotationBatches([])).toEqual([]);
  });

  it("limits the title to 255 characters", () => {
    const batches = annotationBatches([{ ...annotation(1), title: "x".repeat(300) }]);
    expect(batches[0]?.[0]?.title).toHaveLength(255);
  });
});

describe("findings in the summary", () => {
  const findings = Array.from({ length: 3 }, (_, at) => annotation(at));

  it("lists the current findings first, then the link, and ends with the hash of the set", () => {
    const summary = summaryOf({ ...base, state: "pending", annotations: findings });
    const lines = summary.split("\n\n");
    expect(lines[0]).toBe(base.description);
    expect(lines[1]).toBe("Current findings (3):\n- t0 (`a.tsx`)\n- t1 (`a.tsx`)\n- t2 (`a.tsx`)");
    expect(lines[2]).toBe(`[Open the build](${base.url})`);
    expect(markedHash(summary)).toBe(findingsHash(findings));
  });

  it("spells out only the first findings and counts the rest", () => {
    const many = Array.from({ length: FINDINGS_LISTED + 4 }, (_, at) => annotation(at));
    const summary = summaryOf({ ...base, state: "pending", annotations: many });
    expect(summary).toContain(`Current findings (${String(many.length)}):`);
    expect(summary).toContain("- and 4 more");
    expect(summary).not.toContain(`- t${String(FINDINGS_LISTED)} (`);
  });

  it("says how many earlier annotations on the run are history", () => {
    const one = summaryOf({ ...base, state: "pending", annotations: findings, resolved: 1 });
    const two = summaryOf({ ...base, state: "pending", annotations: findings, resolved: 2 });
    expect(one).toContain("1 earlier annotation belongs to findings");
    expect(two).toContain("2 earlier annotations belong to findings");
    expect(summaryOf({ ...base, state: "pending", annotations: findings })).not.toContain(
      "earlier annotation",
    );
  });

  it("carries a hash for a build with no findings yet, and none for a status without findings", () => {
    const empty = summaryOf({ ...base, state: "pending", annotations: [] });
    expect(empty).not.toContain("Current findings");
    expect(markedHash(empty)).toBe(findingsHash([]));
    expect(markedHash(summaryOf({ ...base, state: "pending" }))).toBeUndefined();
  });

  it("hashes the set, not the order, and tells a changed finding from an unchanged one", () => {
    expect(findingsHash(findings.toReversed())).toBe(findingsHash(findings));
    const changed = [findings[0], findings[1], { ...annotation(2), message: "other" }];
    expect(findingsHash(changed as typeof findings)).not.toBe(findingsHash(findings));
    expect(findingsHash([])).not.toBe(findingsHash(findings));
  });

  it("keys a finding by what the annotation shows, with the title cut as it is posted", () => {
    const long = { ...annotation(1), title: "x".repeat(300) };
    const posted = annotationBatches([long])[0]?.[0];
    expect(posted).toBeDefined();
    expect(
      findingKey({
        level: posted?.annotation_level ?? "",
        path: posted?.path ?? "",
        title: posted?.title ?? "",
        message: posted?.message ?? "",
        url: posted?.raw_details ?? "",
      }),
    ).toBe(findingKey(long));
  });

  it("reads no hash from a summary without one", () => {
    expect(markedHash(null)).toBeUndefined();
    expect(markedHash("plain text")).toBeUndefined();
  });
});

const OLDER = "01JBZ0000000000000000000AA";
const NEWER = "01JBZ0000000000000000000BB";
const link = (id: string, tail = "") => `https://shelf.example/projects/web/builds/${id}${tail}`;

describe("build ids in links", () => {
  it("reads the ULID from a build link, its sub pages and a query", () => {
    expect(buildIdOf(link(OLDER))).toBe(OLDER);
    expect(buildIdOf(link(OLDER, "/diff?snapshot=S1"))).toBe(OLDER);
    expect(buildIdOf(link(OLDER, "?x=1"))).toBe(OLDER);
    expect(buildIdOf(`${link(OLDER)}#frag`)).toBe(OLDER);
  });

  it("reads nothing from a link without a build id", () => {
    expect(buildIdOf()).toBeUndefined();
    expect(buildIdOf(null)).toBeUndefined();
    expect(buildIdOf("https://shelf.example/projects/web/builds/B1")).toBeUndefined();
    expect(buildIdOf(`https://shelf.example/projects/web?next=/builds/${NEWER}`)).toBeUndefined();
    expect(buildIdOf(`https://shelf.example/x#/builds/${NEWER}`)).toBeUndefined();
    expect(buildIdOf("not a url")).toBeUndefined();
    expect(buildIdOf("https://shelf.example/projects/web")).toBeUndefined();
  });

  it("calls a run newer only when both ids read and the shown one sorts after", () => {
    expect(showsNewerBuild(link(NEWER), link(OLDER))).toBe(true);
    expect(showsNewerBuild(link(OLDER), link(NEWER))).toBe(false);
    expect(showsNewerBuild(link(OLDER), link(OLDER))).toBe(false);
    expect(showsNewerBuild(link(NEWER))).toBe(false);
    expect(showsNewerBuild(null, link(OLDER))).toBe(false);
    expect(showsNewerBuild("https://shelf.example/x", link(OLDER))).toBe(false);
  });
});
