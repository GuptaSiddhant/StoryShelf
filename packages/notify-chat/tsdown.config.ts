import { libConfig } from "../../config/tsdown.ts";

export default libConfig({
  index: "./src/index.ts",
  slack: "./src/slack.ts",
  teams: "./src/teams.ts",
  log: "./src/log.ts",
});
