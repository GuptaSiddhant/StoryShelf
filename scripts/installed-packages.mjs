/**
 * Where an installed tree holds a package, at any depth: `node_modules/<name>` and every nested
 * `node_modules/**` below another package, which is where a bundled dependency lands (#1334).
 * The packed-install smoke uses it to prove a package pulled in no core, Drizzle or pino.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/** Package directories directly inside one `node_modules` (scoped ones included). */
function packageDirs(modulesDir) {
  return readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .flatMap((entry) =>
      entry.name.startsWith("@")
        ? readdirSync(join(modulesDir, entry.name), { withFileTypes: true })
            .filter((inner) => inner.isDirectory())
            .map((inner) => join(modulesDir, entry.name, inner.name))
        : [join(modulesDir, entry.name)],
    );
}

/** Paths, relative to `root`, of every installed copy of any of `names` under `root/node_modules`. */
export function findInstalled(root, names) {
  const found = [];
  const visit = (modulesDir) => {
    for (const dir of packageDirs(modulesDir)) {
      if (names.some((name) => dir === join(modulesDir, name))) {
        found.push(relative(root, dir));
      }
      const nested = join(dir, "node_modules");
      if (existsSync(nested)) {
        visit(nested);
      }
    }
  };
  const top = join(root, "node_modules");
  if (existsSync(top)) {
    visit(top);
  }
  return found;
}
