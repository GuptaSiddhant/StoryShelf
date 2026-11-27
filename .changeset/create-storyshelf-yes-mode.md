---
"create-storyshelf": patch
"@storyshelf/app": patch
---

Added: `create-storyshelf --yes` takes every default, and `storyshelf-server` stops on a Node below its range

`--yes` (`-y`) scaffolds without prompts or a terminal; the no-terminal message now names it. The Docker question defaults to no after "Local (bare node)" and stays yes for the Docker target. `storyshelf-server` stops with one line and exit 1 on a Node below `@storyshelf/app`'s `engines.node`, read from the version manifest (now carrying each package's Node range), and the scaffold's `engines` comes from the same place.

Schema: none
