import { stateNotifierContractSuite } from "@storyshelf/core/test-helpers";
import { gitHubNotifier, gitLabNotifier } from "./index.ts";

stateNotifierContractSuite("github", () => gitHubNotifier, { owner: "acme", repo: "widgets" });
stateNotifierContractSuite("gitlab", () => gitLabNotifier, { owner: "acme", repo: "widgets" });
