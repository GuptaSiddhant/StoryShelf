import { notifierContractSuite } from "../../test-helpers/index.ts";
import { createEmailNotifier } from "./email.ts";
import { logPreset } from "./log.ts";

notifierContractSuite("email", () => createEmailNotifier(logPreset()));
