import { describe, expect, it } from "vitest";
import {
  deriveReviewStatus,
  latestVerdicts,
  type ReviewStatusInput,
} from "./build-review-status.ts";

let counter = 0;
function review(userId: string | null, verdict: "approved" | "rejected", createdAt?: string) {
  counter += 1;
  const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, counter)).toISOString();
  return { id: `r${String(counter)}`, userId, verdict, createdAt: createdAt ?? stamp } as const;
}

const base: ReviewStatusInput = { testing: false, review: true, approvalsRequired: 1, reviews: [] };

describe("deriveReviewStatus", () => {
  it("is pending until a verdict is given", () => {
    expect(deriveReviewStatus(base)).toBe("pending");
  });

  it("approves once the required approvals are present", () => {
    const reviews = [review("a", "approved")];
    expect(deriveReviewStatus({ ...base, reviews })).toBe("approved");
    expect(deriveReviewStatus({ ...base, reviews, approvalsRequired: 2 })).toBe("pending");
    const two = [...reviews, review("b", "approved")];
    expect(deriveReviewStatus({ ...base, reviews: two, approvalsRequired: 2 })).toBe("approved");
  });

  it("counts one reviewer once, however often they rewrite", () => {
    const reviews = [review("a", "approved"), review("a", "approved")];
    expect(deriveReviewStatus({ ...base, reviews, approvalsRequired: 2 })).toBe("pending");
  });

  it("rejects when any reviewer's latest verdict is a rejection", () => {
    const reviews = [review("a", "approved"), review("b", "rejected")];
    expect(deriveReviewStatus({ ...base, reviews })).toBe("rejected");
  });

  it("follows a rewritten verdict in both directions", () => {
    const rejectedThenApproved = [review("a", "rejected"), review("a", "approved")];
    expect(deriveReviewStatus({ ...base, reviews: rejectedThenApproved })).toBe("approved");
    const approvedThenRejected = [review("a", "approved"), review("a", "rejected")];
    expect(deriveReviewStatus({ ...base, reviews: approvedThenRejected })).toBe("rejected");
  });

  it("treats a required count below 1 as 1", () => {
    expect(deriveReviewStatus({ ...base, approvalsRequired: 0 })).toBe("pending");
    expect(
      deriveReviewStatus({ ...base, approvalsRequired: 0, reviews: [review("a", "approved")] }),
    ).toBe("approved");
  });

  it("does not decide the status with testing on or review off", () => {
    const reviews = [review("a", "rejected")];
    expect(deriveReviewStatus({ ...base, testing: true, reviews })).toBeNull();
    expect(deriveReviewStatus({ ...base, review: false, reviews })).toBeNull();
    expect(deriveReviewStatus({ ...base, testing: true, review: false, reviews })).toBeNull();
  });

  it("does not depend on the order the reviews arrive in", () => {
    const reviews = [
      review("a", "approved", "2026-01-02T00:00:00.000Z"),
      review("a", "rejected", "2026-01-01T00:00:00.000Z"),
    ];
    expect(deriveReviewStatus({ ...base, reviews })).toBe("approved");
    expect(deriveReviewStatus({ ...base, reviews: [reviews[1]!, reviews[0]!] })).toBe("approved");
  });
});

describe("latestVerdicts", () => {
  it("breaks a createdAt tie by id", () => {
    const stamp = "2026-01-01T00:00:00.000Z";
    const older = { id: "a", userId: "u", verdict: "rejected", createdAt: stamp } as const;
    const newer = { id: "b", userId: "u", verdict: "approved", createdAt: stamp } as const;
    expect(latestVerdicts([newer, older])).toEqual([newer]);
  });

  it("returns reviewers oldest verdict first", () => {
    const a = review("a", "approved", "2026-01-01T00:00:00.000Z");
    const b = review("b", "approved", "2026-01-03T00:00:00.000Z");
    const c = review("c", "approved", "2026-01-02T00:00:00.000Z");
    expect(latestVerdicts([b, c, a]).map((row) => row.userId)).toEqual(["a", "c", "b"]);
  });
});
