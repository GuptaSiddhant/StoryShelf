import { defineConfig } from "tsdown";
import { libConfig } from "../../config/tsdown.ts";

export default defineConfig(libConfig({ index: "src/index.ts" }));
