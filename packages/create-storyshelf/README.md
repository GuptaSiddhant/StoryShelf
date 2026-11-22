# create-storyshelf

Scaffold a self-hosted [StoryShelf](https://storyshelf.js.org) server project.

```sh
npm create storyshelf            # or: npx create-storyshelf, pnpm create storyshelf, …
npm create storyshelf -- --dir ./my-shelf --install
npx create-storyshelf --cloud aws    # a Terraform module stub only (or gcp, azure)
```

It asks for a database, storage and auth, then writes a small TypeScript project whose `src/index.ts` default-exports `defineShelfInstance(…)`; `storyshelf-server` (from `@storyshelf/app`) runs it. `--install` installs the dependencies with the package manager that launched it; without it nothing is installed.

The package has no dependencies and does not depend on `@storyshelf/app` or `@storyshelf/core`. Docs: https://storyshelf.js.org/guides/cli/server/
