import { describe, expect, it } from "vitest";
import {
  annotationBatches,
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

  it("skips what the run already shows", () => {
    expect(annotationBatches(many, 110).map((batch) => batch.length)).toEqual([10]);
    expect(annotationBatches(many, 120)).toEqual([]);
  });

  it("limits the title to 255 characters", () => {
    const batches = annotationBatches([{ ...annotation(1), title: "x".repeat(300) }]);
    expect(batches[0]?.[0]?.title).toHaveLength(255);
  });
});
