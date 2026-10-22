/**
 * The serverless-host check lives in core (`assertServerless` needs it too); this re-export keeps
 * the publishing code importing it from one local place.
 */
export { isServerlessHost } from "@storyshelf/core/config";
