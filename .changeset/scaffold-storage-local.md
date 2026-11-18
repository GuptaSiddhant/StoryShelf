---
"storyshelf": patch
---

Fixed: the default `server init` scaffold now depends on `@storyshelf/storage-local`

The generated `src/index.ts` imports `createLocalStorage`, but `package.json` left the package out,
so `npm start` failed with `ERR_MODULE_NOT_FOUND` on a fresh install. Every storage choice is listed now.
