# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The canonical agent guide is `AGENTS.md` — toolchain, commands, layout, architecture, conventions, lint rules and ADR index all live there. It is imported below so there is one source of truth; edit `AGENTS.md`, not this file, when those change.

@AGENTS.md

## Claude Code specifics

- **Skills** live in `.agents/skills/` (tool-neutral); `.claude/skills` is a symlink to it, so `ui-building-blocks` and `adapter-layout` load automatically. Edit them under `.agents/skills/`.
- **Running a single test:** from the package dir, `nubx vitest run src/path/to/file.test.ts` (add `-t "<name>"` to filter by test name). Integration suites follow the same pattern, e.g. `nubx vitest run src/smoke.integration.test.ts`.
- **Node 24.x is required** (`devEngines.runtime` fails hard otherwise). If `~/.nub/bin` doesn't exist the toolchain isn't installed yet; run `nub ci` once it is.
- **Launch configs** in `.claude/launch.json`: `app` (`nub run serve`, port 3000) and `website` (astro dev, port 4321).
- **Commit hooks** (`nub run hook:install`): pre-commit rejects whitespace errors and non-oxfmt/oxlint-clean staged files; commit-msg enforces conventional commits. Fix with `nub run fmt` and re-stage rather than bypassing.
- **What CI runs** (`.github/workflows/ci.yml`): `nub ci` → `nubx turbo verify` (turbo cache restored from `main`; the website runs in its own job) → `scripts/smoke.sh` → link/a11y checks on the website, plus a matrix job that builds each `fixtures/storybook-*` with pnpm and runs `nub run test:integration` against it. Reproduce locally with the same commands before pushing.
