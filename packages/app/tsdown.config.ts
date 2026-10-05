import { libConfig } from "../../config/tsdown.ts";

export default {
  ...libConfig({ index: "./src/index.tsx" }),
  // Ship the vendored HTMX bundle next to the compiled routers so the assets
  // router can resolve `../assets/htmx.min.js` from `dist/routers/assets.mjs`.
  copy: [{ from: "src/assets", to: "dist" }],
};
