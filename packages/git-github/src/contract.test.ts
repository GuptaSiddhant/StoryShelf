import { gitContractSuite } from "@storyshelf/core/test-helpers";
import { gitHubHost } from "./index.ts";

gitContractSuite("github", () => gitHubHost);
