/**
 * Story-only stand-in for server-only packages (image processing, zip extraction, …) that pages
 * reach through `@storyshelf/core` and the routers but that a story never calls. Importing them
 * must not run anything, so this module is empty.
 */
const inert: Record<string, never> = {};

export default inert;
export const PNG = inert;
export const Open = inert;
export const Parse = inert;
