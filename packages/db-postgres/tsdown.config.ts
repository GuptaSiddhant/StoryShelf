import { libConfig } from "../../config/tsdown.ts";

export default libConfig({
  index: "./src/index.ts",
  pg: "./src/pg.ts",
  neon: "./src/neon.ts",
  "neon-http": "./src/neon-http.ts",
  vercel: "./src/vercel.ts",
  pglite: "./src/pglite.ts",
  ddl: "./src/ddl.ts",
  schema: "./src/schema/index.ts",
});
