import { Hono } from "hono";
import type { HtmlEscapedString } from "hono/utils/html";
import { describe, expect, it } from "vite-plus/test";
import {
  A11yViolationsDetails,
  A11yViolationsNotice,
  a11yBaselineShaOf,
  a11yCarrierOf,
  a11yFindingsOf,
  a11yParametersNoteOf,
  a11ySummaryNote,
  a11ySummaryOf,
  a11yViolationsOf,
  isAxeUnavailable,
} from "./a11y-violations.tsx";

const WITH = {
  a11yViolations: JSON.stringify(["color-contrast (serious): x"]),
  browser: "chromium",
};
const WITHOUT = { a11yViolations: null, browser: "firefox" };
const NONE = { findings: 0, snapshots: 0, fromBaseline: 0, baselineSnapshots: 0, unavailable: 0 };

describe("a11yViolationsOf", () => {
  it("reads the stored list and tolerates unreadable data", () => {
    expect(a11yViolationsOf(WITH)).toEqual(["color-contrast (serious): x"]);
    expect(a11yViolationsOf(WITHOUT)).toEqual([]);
    expect(a11yViolationsOf({ a11yViolations: "{" })).toEqual([]);
  });
});

describe("a11yCarrierOf", () => {
  it("finds the sibling that carries the findings (axe runs on the primary target only)", () => {
    expect(a11yCarrierOf(WITHOUT, [WITHOUT, WITH])).toBe(WITH);
    expect(a11yCarrierOf(WITH, [WITH, WITHOUT])).toBe(WITH);
    expect(a11yCarrierOf(WITHOUT, [WITHOUT])).toBe(WITHOUT);
  });
});

describe("a11ySummaryOf", () => {
  it("totals the findings and counts the snapshots that carry any", () => {
    const two = { a11yViolations: JSON.stringify(["a", "b"]) };
    expect(a11ySummaryOf([WITH, two, WITHOUT, { a11yViolations: "{" }])).toEqual({
      findings: 3,
      snapshots: 2,
      unavailable: 0,
      fromBaseline: 0,
      baselineSnapshots: 0,
    });
    expect(a11ySummaryOf([])).toEqual(NONE);
  });
});

describe("overflow line", () => {
  it("counts the N violations an `…and N more` line stands for", () => {
    const capped = { a11yViolations: JSON.stringify(["a", "b", "…and 7 more"]) };
    expect(a11ySummaryOf([capped, WITH])).toEqual({ ...NONE, findings: 10, snapshots: 2 });
  });
});

describe("a11ySummaryNote", () => {
  it("never claims none were found when nothing is recorded", () => {
    expect(a11ySummaryNote(NONE)).toBe("No findings recorded. Information only.");
    expect(a11ySummaryNote({ ...NONE, findings: 3, snapshots: 1 })).toContain("On 1 snapshot.");
  });
});

describe("axe unavailable markers", () => {
  const DOWN = {
    a11yViolations: JSON.stringify(["axe unavailable: Execution context was destroyed"]),
    browser: "chromium",
  };
  const MIXED = {
    a11yViolations: JSON.stringify(["axe unavailable: boom", "color-contrast (serious): x"]),
    browser: "chromium",
  };

  it("is told apart from a finding by one helper", () => {
    expect(isAxeUnavailable("axe unavailable: boom")).toBe(true);
    expect(isAxeUnavailable("color-contrast (serious): x")).toBe(false);
    expect(a11yFindingsOf(DOWN)).toEqual([]);
    expect(a11yViolationsOf(DOWN)).toHaveLength(1);
  });

  it("never counts toward the build total; it is reported on its own", () => {
    expect(a11ySummaryOf([DOWN, WITH, MIXED])).toEqual({
      ...NONE,
      findings: 2,
      snapshots: 2,
      unavailable: 2,
    });
    const note = a11ySummaryNote(a11ySummaryOf([DOWN]));
    expect(note).toContain("No findings recorded.");
    expect(note).toContain("axe did not run on 1 snapshot.");
  });

  it("shows the library disclosure when axe could not run without labeling it a finding", async () => {
    const app = new Hono().get("/", (c): Response | Promise<Response> =>
      c.html(<A11yViolationsDetails snapshot={DOWN} />),
    );
    const html = await (await app.request("/")).text();
    expect(html).toContain("axe did not run on chromium");
    expect(html).toContain("Execution context was destroyed");
    expect(html).not.toContain("a11y 1");
  });

  it("prefers a sibling with findings over a snapshot whose axe run failed", () => {
    expect(a11yCarrierOf(DOWN, [DOWN, WITH])).toBe(WITH);
    expect(a11yCarrierOf(WITHOUT, [WITHOUT, DOWN])).toBe(DOWN);
  });
});

const INHERITED = {
  a11yViolations: JSON.stringify([
    "from baseline 0123456",
    "color-contrast (serious): x",
    "a",
    "b",
  ]),
  browser: "chromium",
};
const PARAMS = {
  a11yViolations: JSON.stringify([
    "a11y parameters not serializable: refers to itself (cyclic)",
    "color-contrast (serious): x",
  ]),
  browser: "chromium",
};

async function render(node: HtmlEscapedString | Promise<HtmlEscapedString>): Promise<string> {
  const app = new Hono().get("/", (c): Response | Promise<Response> => c.html(node));
  return await (await app.request("/")).text();
}

describe("findings inherited from a baseline", () => {
  it("keeps the note out of the findings and names the baseline's short sha", () => {
    expect(a11yFindingsOf(INHERITED)).toEqual(["color-contrast (serious): x", "a", "b"]);
    expect(a11yBaselineShaOf(INHERITED)).toBe("0123456");
    expect(a11yBaselineShaOf(WITH)).toBeUndefined();
  });

  it("is totalled on its own, never as findings measured on this build", () => {
    const summary = a11ySummaryOf([WITH, INHERITED]);
    expect(summary).toEqual({
      ...NONE,
      findings: 1,
      snapshots: 1,
      fromBaseline: 3,
      baselineSnapshots: 1,
    });
    const note = a11ySummaryNote(summary);
    expect(note).toContain("On 1 snapshot.");
    expect(note).toContain(
      "1 inherited snapshot shows findings from the baseline, not measured on this build.",
    );
    expect(a11ySummaryNote(a11ySummaryOf([INHERITED]))).toContain("No findings recorded.");
  });

  it("labels the review notice and the card badge as from the baseline", async () => {
    const notice = await render(<A11yViolationsNotice snapshot={INHERITED} />);
    expect(notice).toContain(
      "3 from baseline 0123456 (not measured on this build; does not block)",
    );
    expect(notice).not.toContain("3 found");
    const card = await render(<A11yViolationsDetails snapshot={INHERITED} />);
    expect(card).toContain("a11y 3");
    expect(card).toContain("from baseline 0123456");
  });
});

describe("a11y parameters that could not be read", () => {
  it("is a note, not a finding, and is told apart by one helper", () => {
    expect(a11yFindingsOf(PARAMS)).toEqual(["color-contrast (serious): x"]);
    expect(a11yParametersNoteOf(PARAMS)).toBe("refers to itself (cyclic)");
    expect(a11yParametersNoteOf(WITH)).toBeUndefined();
    expect(a11ySummaryOf([PARAMS])).toEqual({ ...NONE, findings: 1, snapshots: 1 });
  });

  it("says axe ran with its defaults, beside the findings or alone", async () => {
    const withFinding = await render(<A11yViolationsNotice snapshot={PARAMS} />);
    expect(withFinding).toContain("1 found on chromium");
    expect(withFinding).toContain(
      "could not be read (refers to itself (cyclic)), so axe ran with its defaults",
    );
    const alone = {
      a11yViolations: JSON.stringify([
        "a11y parameters not serializable: nested more than 32 levels deep",
      ]),
      browser: "chromium",
    };
    const notice = await render(<A11yViolationsNotice snapshot={alone} />);
    expect(notice).toContain("story parameters not applied on chromium");
    expect(notice).not.toContain("found");
    expect(await render(<A11yViolationsDetails snapshot={alone} />)).toContain(
      "story parameters not applied on chromium",
    );
  });
});

describe("a parameters note on the primary target", () => {
  it("is found from a secondary target's snapshot, which has nothing of its own", async () => {
    const primary = {
      a11yViolations: JSON.stringify([
        "a11y parameters not serializable: refers to itself (cyclic)",
      ]),
      browser: "chromium",
    };
    const carrier = a11yCarrierOf(WITHOUT, [WITHOUT, primary]);
    expect(carrier).toBe(primary);
    expect(await render(<A11yViolationsNotice snapshot={carrier} />)).toContain(
      "story parameters not applied on chromium",
    );
  });
});

describe("a multi-target build whose primary capture failed", () => {
  it("takes the findings from the target that captured and says which one", async () => {
    const webkit = {
      a11yViolations: JSON.stringify(["color-contrast (serious): x"]),
      browser: "webkit",
    };
    const firefox = { a11yViolations: null, browser: "firefox" };
    // The primary target has no snapshot for this story: only the secondary targets exist.
    const carrier = a11yCarrierOf(firefox, [firefox, webkit]);
    expect(carrier).toBe(webkit);
    expect(await render(<A11yViolationsNotice snapshot={carrier} />)).toContain(
      "1 found on webkit",
    );
    expect(await render(<A11yViolationsDetails snapshot={carrier} />)).toContain("a11y 1");
  });
});
