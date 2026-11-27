---
"storyshelf": patch
---

Fixed: bare `storyshelf` takes `upload`'s options

`storyshelf --wait --branch main` (and `--sha`, `--json`, `--dry-run` and the rest) was rejected as an unknown option, because only `storyshelf upload` declared them. Bare `storyshelf [options]` now runs `upload [options]` from the same option table, so the two cannot drift. `storyshelf --help` still lists the commands, an unknown flag or subcommand still errors, and without a config it still points at `init`. Schema: none.
