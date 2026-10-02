import { notifierContractSuite } from "@storyshelf/core/test-helpers";
import { createEmailNotifier } from "./email.ts";
import { logPreset } from "./log.ts";

notifierContractSuite("email", () => createEmailNotifier(logPreset()));
