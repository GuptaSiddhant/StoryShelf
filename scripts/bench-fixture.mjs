// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
/* oxlint-disable */
/**
 * Generates the Storybook that `scripts/bench-shards.mjs` captures (ADR 0031).
 *
 *   node scripts/bench-fixture.mjs --out .tmp/bench-sb [--stories 600] [--heavy even|first] [--heavy-count 60]
 *                                  [--node-modules <dir>]
 *   cd .tmp/bench-sb && nubx storybook build -o storybook-static
 *   node scripts/bench-shards.mjs --storybook .tmp/bench-sb/storybook-static
 *
 * Stories are a small card (light) or a 4000-cell grid with a 1.5 s `play` (heavy). `--heavy even`
 * spreads the heavy stories evenly through the build, `--heavy first` puts them all at the start,
 * which is the case where ordering shards by past cost has something to improve. The ADR's tables
 * used 600 stories with 60 heavy: `even` for the configuration table, `first` (90 heavy) for the
 * ordering runs.
 *
 * The generated project reuses `fixtures/storybook-8`'s Storybook config and links a
 * `node_modules` into it: `--node-modules <dir>`, else `fixtures/storybook-8/node_modules`
 * (install it first: `cd fixtures/storybook-8 && pnpm install`). It stops if there is none, since
 * the build would otherwise fail.
 */
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = join(root, "fixtures/storybook-8");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};

const out = resolve(flag("--out", ""));
if (!args.includes("--out") || out === resolve(".")) {
  console.error(
    "usage: bench-fixture.mjs --out <dir> [--stories 600] [--heavy even|first] [--heavy-count 60]",
  );
  process.exit(2);
}
const total = Number(flag("--stories", 600));
const heavyCount = Number(flag("--heavy-count", Math.round(total / 10)));
const placement = flag("--heavy", "even");
const perFile = 15;

const isHeavy = (index) =>
  placement === "first" ? index < heavyCount : index % Math.round(total / heavyCount) === 0;

const CARD = `import * as React from "react";
export function Card({ title, rows = 3 }: { title: string; rows?: number }) {
  return (
    <div style={{ fontFamily: "system-ui", padding: 16, width: 360, border: "1px solid #ddd" }}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      {Array.from({ length: rows }, (_v, i) => <p key={i} style={{ margin: "4px 0" }}>row {i} of {title}</p>)}
    </div>
  );
}
export function Grid({ cells }: { cells: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(40, 24px)", gap: 2 }}>
      {Array.from({ length: cells }, (_v, i) => <span key={i} style={{ background: \`hsl(\${i % 360} 60% 70%)\`, height: 24 }}>{i % 10}</span>)}
    </div>
  );
}
`;

function story(index, file, slot) {
  return isHeavy(index)
    ? `export const S${slot}: StoryObj = { render: () => <Grid cells={4000} />, play: async () => { await new Promise((r) => setTimeout(r, 1500)); } };`
    : `export const S${slot}: StoryObj = { render: () => <Card title="C${file}-${slot}" rows={${2 + (slot % 4)}} /> };`;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "src"), { recursive: true });
for (const name of [".storybook", "package.json", "tsconfig.json"]) {
  cpSync(join(base, name), join(out, name), { recursive: true });
}
const modules = resolve(flag("--node-modules", join(base, "node_modules")));
if (!existsSync(modules)) {
  console.error(
    `no node_modules at ${modules}; run \`pnpm install\` in fixtures/storybook-8 or pass --node-modules`,
  );
  process.exit(2);
}
symlinkSync(modules, join(out, "node_modules"));
writeFileSync(join(out, "src/Card.tsx"), CARD);
const files = Math.ceil(total / perFile);
for (let file = 0; file < files; file += 1) {
  const lines = [
    'import type { Meta, StoryObj } from "@storybook/react";',
    'import { Card, Grid } from "./Card";',
    `const meta: Meta = { title: "Group${Math.floor(file / 5)}/Component${file}", component: Card };`,
    "export default meta;",
  ];
  for (let slot = 0; slot < perFile && file * perFile + slot < total; slot += 1) {
    lines.push(story(file * perFile + slot, file, slot));
  }
  writeFileSync(join(out, `src/Comp${file}.stories.tsx`), `${lines.join("\n")}\n`);
}
const heavy = Array.from({ length: total }, (_v, i) => i).filter(isHeavy).length;
console.log(`wrote ${total} stories (${heavy} heavy, ${placement}) to ${out}`);
