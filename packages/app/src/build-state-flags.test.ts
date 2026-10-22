import { expect, it } from "vitest";
import { buildStateFlags } from "./build-state-flags.ts";

it("takes testing from the instance and review from the project switch", () => {
  expect(buildStateFlags(true, { reviewEnabled: true })).toEqual({ testing: true, review: true });
  expect(buildStateFlags(false, { reviewEnabled: false })).toEqual({
    testing: false,
    review: false,
  });
});

it("counts a row without the column as review on, the default", () => {
  const row = {} as { reviewEnabled: boolean };
  expect(buildStateFlags(false, row)).toEqual({ testing: false, review: true });
});
