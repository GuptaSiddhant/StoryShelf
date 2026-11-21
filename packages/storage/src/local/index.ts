/**
 * Local-disk storage, re-exported from core so every backend imports from one package. The
 * implementation stays in `@storyshelf/core/storage/local`; this subpath adds no dependency.
 *
 * @module
 */
export { createLocalStorage } from "@storyshelf/core/storage/local";
