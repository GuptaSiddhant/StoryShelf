import { libConfig } from "../../config/tsdown.ts";

export default libConfig({
  index: "./src/index.ts",
  ddl: "./src/ddl.ts",
  planetscale: "./src/planetscale.ts",
  tidb: "./src/tidb.ts",
  schema: "./src/schema/index.ts",
});
