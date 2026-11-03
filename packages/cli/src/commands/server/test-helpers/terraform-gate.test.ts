import { describe, expect, it, vi } from "vitest";
import { terraformGate } from "./terraform-gate.ts";

describe("terraformGate", () => {
  it.each([undefined, "", "0", "true", "yes"])(
    "does not probe for terraform when RUN_TERRAFORM is %j",
    (value) => {
      const probe = vi.fn(() => true);
      const env = value === undefined ? {} : { RUN_TERRAFORM: value };
      expect(terraformGate(env, probe)).toEqual({ runTerraform: false, hasTerraform: false });
      expect(probe).not.toHaveBeenCalled();
    },
  );

  it("probes once and reports the binary when RUN_TERRAFORM=1", () => {
    const probe = vi.fn(() => true);
    expect(terraformGate({ RUN_TERRAFORM: "1" }, probe)).toEqual({
      runTerraform: true,
      hasTerraform: true,
    });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("reports a missing binary as such, so the suites can fail rather than skip", () => {
    expect(terraformGate({ RUN_TERRAFORM: "1" }, () => false)).toEqual({
      runTerraform: true,
      hasTerraform: false,
    });
  });
});
