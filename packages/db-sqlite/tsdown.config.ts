import { libConfig } from "../../config/tsdown.ts";

export default libConfig({
  index: "./src/index.ts",
  "drizzle-factory": "./src/drizzle-factory.ts",
  ddl: "./src/ddl.ts",
  schema: "./src/schema/index.ts",
});
