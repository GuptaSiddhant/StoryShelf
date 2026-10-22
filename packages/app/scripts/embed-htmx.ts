/**
 * Regenerates `src/assets/htmx.ts` from a downloaded `htmx.min.js`:
 *
 *   nub packages/app/scripts/embed-htmx.ts <path to htmx.min.js>
 *
 * Get the file from the npm package (`npm pack htmx.org@<version>`, then `package/dist/htmx.min.js`).
 * The text is embedded verbatim in a `String.raw` template, so it must not contain a backtick or
 * `${`; the script refuses if it does. Format the result with `nub run fmt`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const input = process.argv[2];
if (!input) {
  throw new Error("usage: embed-htmx.ts <path to htmx.min.js>");
}
const source = await readFile(resolve(input), "utf8");
const version = /version: "(\d+\.\d+\.\d+)"/u.exec(source)?.[1];
if (!version) {
  throw new Error(`${input}: no htmx version string found; is this htmx.min.js?`);
}
if (source.includes("`") || source.includes("${")) {
  throw new Error(`${input}: contains a backtick or "\${"; embed it as a JSON string instead`);
}
const output = `/**
 * htmx ${version}, vendored as shipped in \`htmx.org@${version}/dist/htmx.min.js\` (formatted by oxfmt).
 *
 * Embedded as a string so it travels inside the compiled JavaScript: there is no file to find
 * at runtime, whether the app runs from source, from the library build or inside a bundle.
 * To upgrade, run \`nub packages/app/scripts/embed-htmx.ts <path to the new htmx.min.js>\`.
 */
export const htmxVersion = "${version}";

export const htmxSource = String.raw\`${source}\`;
`;
const target = new URL("../src/assets/htmx.ts", import.meta.url);
await writeFile(target, output);
console.log(`wrote ${target.pathname} (htmx ${version}, ${source.length} bytes)`);
