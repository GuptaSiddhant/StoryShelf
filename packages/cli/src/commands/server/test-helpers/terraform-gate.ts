import { spawnSync } from "node:child_process";

/** What the Terraform scaffold suites need to decide whether to run. */
export interface TerraformGate {
  /** `RUN_TERRAFORM=1`: the suites are switched on (CI's `verify` job sets it). */
  readonly runTerraform: boolean;
  /** A `terraform` binary answers, probed only when `runTerraform` is set. */
  readonly hasTerraform: boolean;
}

/** Whether a `terraform` binary runs here. `terraform version` can reach the network. */
export function terraformAvailable(): boolean {
  return spawnSync("terraform", ["version"], { stdio: "ignore" }).status === 0;
}

/**
 * Reads the `RUN_TERRAFORM` gate. `terraform init` downloads providers, so the suites run only
 * when it is `1`; the default test run stays hermetic even where a binary is installed and does
 * not even probe for one. With the gate set, a missing binary is a failure, not a skip.
 */
export function terraformGate(
  env: NodeJS.ProcessEnv = process.env,
  probe: () => boolean = terraformAvailable,
): TerraformGate {
  const runTerraform = env["RUN_TERRAFORM"] === "1";
  return { runTerraform, hasTerraform: runTerraform && probe() };
}
