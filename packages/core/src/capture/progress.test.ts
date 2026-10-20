import { describe, expect, it } from "vitest";
import { leaseProgress } from "./progress.ts";

describe("leaseProgress", () => {
  it("is undefined without a lease", () => {
    expect(leaseProgress()).toBeUndefined();
  });

  it("touches the lease at once, then at most once per interval", () => {
    let clock = 0;
    let touches = 0;
    const progress = leaseProgress(
      {
        touch: () => {
          touches += 1;
        },
      },
      100,
      () => clock,
    );

    progress?.();
    progress?.();
    clock = 99;
    progress?.();
    expect(touches).toBe(1);
    clock = 100;
    progress?.();
    clock = 150;
    progress?.();
    expect(touches).toBe(2);
    clock = 200;
    progress?.();
    expect(touches).toBe(3);
  });
});
