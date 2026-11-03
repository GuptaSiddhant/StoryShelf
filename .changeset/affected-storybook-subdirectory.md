---
"@storyshelf/affected": patch
"storyshelf": patch
---

**Fixed: affected capture now works when Storybook lives in a subdirectory of the repository.**
In a monorepo package, a change such as `packages/app/src/ui/kbd.tsx` was matched against module
ids like `./src/ui/kbd.tsx` and never found, so every story was inherited and nothing was
re-rendered. Changed files and bundler module ids are now resolved to absolute paths before they
are compared, so changes inside the package and in sibling workspace packages find the stories
that import them. `untraced` globs match the project-relative and the repository-relative form of
a path. When the repository root or the project's place in it cannot be determined, the upload
renders everything with the reason `path-base-unknown`. `storyshelf doctor` now reports the
project and repository roots it uses. Run `upload` from the Storybook package. (#502)
