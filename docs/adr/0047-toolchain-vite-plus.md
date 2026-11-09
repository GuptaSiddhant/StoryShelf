# ADR 0047: Toolchain on Vite+

## Status

Accepted (owner, 2026-11-09; proposed by the architect). The migration lands on an epic branch, and
it happens only if the spike (the epic's first task) passes the gates below. Until the epic merges,
nub and turbo stay as they are, and AGENTS.md describes them.

## Context

The workspace is held together by two tools besides the compilers:

- **nub 0.10** installs packages (`nub.lock`, `allowScripts`), runs scripts (`nub run --filter`,
  `nubx`) and pins Node 24 (`devEngines`). It is 0.x and changes behaviour in each minor release.
  The 0.10 upgrade failed every install until `allowScripts` named `protobufjs` (#811). Developer
  sessions had no nub until the environment setup script installed it.
- **turbo 2.11** runs the `verify` graph (`^build` → build, Storybook build, lint, test). CI
  restores `main`'s cache (`.github/actions/save-turbo-cache`) and runs `--affected` on pull
  requests. Turbo hashes only the inputs we declare. That makes the "Turbo cache inputs" invariant
  in AGENTS.md a recurring bug class: a test that reads a file outside its package must name that
  file in its `turbo.json`, or the cache replays a stale pass. `ci.yml` keeps a second list, the
  `FULL` regex of paths that force a full run, and that list can drift from turbo's hashing.
  Turbo's only other use is `turbo prune` in `apps/fly-app/Dockerfile`.

The tools that do the work are already VoidZero's: vitest 5, oxlint (type-aware, through
tsgolint on TypeScript 7), oxfmt, tsdown and rolldown. Vite+ 1.0 (MIT, stable since 2026-09-28;
1.5.1 on 2026-11-09) wraps these behind one CLI, `vp`:

| Today                                             | Vite+                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `nub install`, `nub.lock`, `allowScripts`         | `vp install` with pnpm (`pnpm-lock.yaml`, pnpm's build approvals)  |
| `devEngines` Node pin through nub                 | `vp env`                                                           |
| `nub run --filter`, `nubx`                        | `vpr <script>`, `vp run --filter` (pnpm's selector grammar), `vpx` |
| turbo, five `turbo.json`, the `FULL` regex        | `vp run`, with tasks in the root `vite.config.ts`                  |
| oxlint + oxfmt + `tsc --noEmit`, configured apart | `vp check` (`typeAware` and `typeCheck` on)                        |
| vitest, tsdown                                    | `vp test`, `vp pack`                                               |
| `.githooks/`                                      | `vp hooks`, `vp staged`                                            |
| `setup-nub` + `setup-workspace`                   | `setup-vp`                                                         |

Two facts decide the shape of the change:

1. **Vite+ does not run nub.** It drives npm, pnpm, Yarn or Bun. Adopting it means leaving nub for
   pnpm. That is cheap: nub uses pnpm's filter grammar and its lockfile format, and the fixtures
   already install with pnpm.
2. **`vp run` tracks inputs itself.** It records the files a task reads, writes and probes, and
   fingerprints them; `vp build` and `vp test` also report the env vars they use. A file read
   outside a package is an input without any declaration. Env vars that other tasks read are not
   tracked, and must be listed under `cache.env` (or `cache.untrackedEnv`).

## Decision

1. **Move the workspace to Vite+ on pnpm.** One exact `vite-plus` version is pinned in the root
   `package.json`, and Node 24 stays. A version upgrade is its own pull request: Vite+ ships minor
   releases about weekly, and a new bundled oxlint or oxfmt can flag code that passed before.
2. **pnpm replaces nub.**
   - `pnpm-lock.yaml` replaces `nub.lock`.
   - pnpm's build approvals replace `allowScripts`, with the same answers: `better-sqlite3` is
     built and `protobufjs` is not.
   - Commands use `vp install`, `vpr` and `vpx`.
3. **`vp run` replaces turbo.**
   - The `verify` graph moves to `vite.config.ts`, and each env var a task reads is declared under
     `cache.env`.
   - The `turbo.json` files, the `FULL` regex and the "Turbo cache inputs" invariant are removed.
   - CI restores `main`'s `node_modules/.vite/task-cache` the way it restores `.turbo/cache`
     today.
   - Pull requests run the whole workspace from that cache, so tasks whose inputs did not change
     replay instead of running. This replaces `--affected`.
   - The fly-app image installs with `pnpm install --frozen-lockfile --filter fly-app...` instead
     of `turbo prune`.
4. **`vp check`, `vp test` and `vp pack` replace the separate tool invocations.**
   - Lint and format settings move from `.oxlintrc.json` and `.oxfmtrc.json` into the root
     `vite.config.ts`, with no rule changes in the same pull request.
   - The `tsc --noEmit` build of `apps/dev-server` becomes `vp check`.
   - `typescript` stays a dependency: tsgolint and the `.d.ts` emit of `vp pack` use it.
   - The website keeps its own TypeScript 5.9 for Astro.
5. **Hooks and CI follow.**
   - `vp hooks` and `vp staged` replace the pre-commit hook.
   - The conventional-commit check stays a small script, because Vite+ has none.
   - `setup-vp` replaces `setup-nub` in `setup-workspace` and `npm-publish`.
   - npm publishing stays in `release.yml` (ADR 0043, decision 5).
6. **What does not change:** turbo's role in CI ordering is only the `verify` graph, and that moves
   whole. Release scripts keep their behaviour; only their `nub` calls change.
7. **Fixtures stay outside the workspace.** `fixtures/storybook-{8,9,10}` remain independent pnpm
   installs with their own lockfiles, so the capture suite installs Storybook the way a customer
   does. The root `pnpm-workspace.yaml`, its catalog, overrides and build approvals, and the
   root's pinned pnpm version must not reach them. If pnpm would otherwise treat a fixture as part
   of the root workspace, each fixture gets its own `pnpm-workspace.yaml` and `packageManager`.
   The only thing Vite+ may add is a cached `vp run` task that builds a fixture's Storybook
   through its own install, if gate 5 shows it works.

### Gates (the spike, before any migration task)

The spike migrates a throwaway branch with `vp migrate` and runs it in CI beside turbo on the same
commits. The epic goes ahead only if every gate passes, and the findings are posted on the epic:

1. **Replay.** With `main`'s task cache restored, a docs-only pull request and a one-package pull
   request replay every task they do not affect.
2. **Correctness.** Changing a file that a test reads from outside its package re-runs that test.
   Env-dependent tasks (the `env` lists in `turbo.json`, `RUN_TERRAFORM`) re-run when their
   declared variable changes. Two consecutive runs on one commit both replay.
3. **Coverage.** Every current CI step runs: package builds, the app's Storybook build, the website
   (uncached), the fly-app bundle and image, the capture integration job and the release scripts.
4. **Time.** Warm and cold CI times are at most turbo's on the same commits.
5. **Fixtures.** With the root on pnpm and Vite+, each fixture still installs with
   `pnpm --dir fixtures/<name> install --frozen-lockfile` and builds its Storybook. Its
   `pnpm-lock.yaml` stays byte-identical, and the root lockfile does not change. The pnpm version
   a fixture runs is the one it pins, not the root's or Vite+'s managed one. Today the fixtures pin
   none and CI selects pnpm 10 (`pnpm/action-setup` in `setup-workspace`), so the spike adds a
   `packageManager` pin to each fixture first.
   Root `vp install`, `vp check` and `vp test` do not descend into `fixtures/`. The spike also
   reports whether a cached `vp run` task can build a fixture's Storybook from outside the
   workspace and replay it when nothing in the fixture changed.

If a gate fails, the epic stops at the spike, and the findings say what would have to change.
Only the nub → pnpm step may then be proposed on its own, as a separate owner decision.

## Consequences

- One tool and one config file (`vite.config.ts`) replace nub, turbo, two lint/format configs and
  the hook scripts. Contributors and agent sessions run the same `vp` commands.
- A class of cache bug goes away: inputs are recorded, not declared. Env vars still have to be
  declared, so a `cache.env` list replaces `turbo.json`'s `env` lists.
- The lint, format, test and pack tool versions move together with `vite-plus`, so they can no
  longer be pinned one by one. An upgrade may need a lint or format sweep in the same pull request.
- We depend on VoidZero for the whole toolchain. The exit cost stays low: Vite+ wraps standard
  tools and a standard pnpm lockfile, so leaving means calling them directly again.
- The environment setup script installs `vp` instead of nub and Node.
- Open branches conflict on the lockfile and on CI files when the epic merges. The epic therefore
  merges into `main` after the epics already in flight (#804, #814, #815).

## Alternatives considered

- **Keep nub and turbo.** This works, but keeps the youngest dependency on the critical path and
  the hand-declared cache inputs.
- **Replace only turbo, keep nub.** Not possible: Vite+ does not drive nub.
- **Replace only nub with pnpm, keep turbo.** This removes the 0.x risk but keeps the cache-input
  bug class and the duplicate tool configs. It remains the fallback if the spike fails.
- **Stay on turbo and move its cache to Vercel Remote Cache.** This only changes where the cache
  lives; the inputs are still declared by hand.
