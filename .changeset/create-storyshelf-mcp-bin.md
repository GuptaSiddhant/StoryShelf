---
"storyshelf": minor
"@storyshelf/mcp": minor
"create-storyshelf": minor
---

Breaking: `server init` and `mcp …` move to `create-storyshelf` and `storyshelf-mcp`

`npm create storyshelf` (the new dependency-free `create-storyshelf` package) writes the same server project as `storyshelf server init` did, including `--cloud` (Terraform stub only); `--install` is opt-in and uses the package manager that launched it. `storyshelf mcp init` and `storyshelf mcp serve` move to the `storyshelf-mcp` bin of `@storyshelf/mcp` (`init`, `serve`). The old commands are removed with no alias (#1309); the `storyshelf` client no longer carries the scaffold.

Schema: none.
