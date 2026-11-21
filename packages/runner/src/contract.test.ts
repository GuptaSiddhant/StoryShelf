import { runnerContractSuite } from "@storyshelf/core/test-helpers";
import { createCaptureRunner } from "./capture-runner.ts";

runnerContractSuite("playwright", () => createCaptureRunner());
