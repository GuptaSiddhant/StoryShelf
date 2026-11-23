/** Moved to `@storyshelf/common/tracing` (#1334); re-exported for core's own modules. */
export {
  currentTraceparent,
  injectTraceContext,
  parentContext,
  setSpanMessage,
  spanException,
  TRACEPARENT_HEADER,
  withSpan,
} from "@storyshelf/common/tracing";
