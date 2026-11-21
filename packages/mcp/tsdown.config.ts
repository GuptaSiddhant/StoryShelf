import { cliConfig } from "../../config/tsdown.ts";

// The bin (`index`) is the CLI and is not a library entry; `http` is the one public subpath, so
// declarations are emitted for it (`cliConfig` turns them off for a plain CLI).
export default { ...cliConfig({ index: "./src/index.ts", http: "./src/http.ts" }), dts: true };
