/** Moved to `@storyshelf/common/tracing` (#1334); re-exported so core's subpaths keep their names. */
export {
  currentTraceparent,
  injectTraceContext,
  parentContext,
  TRACEPARENT_HEADER,
} from "@storyshelf/common/tracing";
