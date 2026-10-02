import { runnerContractSuite } from "@storyshelf/core/test-helpers";
import { createPlaywrightCaptureRunner } from "./capture-runner.ts";

runnerContractSuite("playwright", () => createPlaywrightCaptureRunner());
