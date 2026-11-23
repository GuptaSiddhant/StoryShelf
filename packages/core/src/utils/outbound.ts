/** Moved to `@storyshelf/common/http` (#1334); re-exported so core's subpaths keep their names. */
export {
  MAX_OUTBOUND_REDIRECTS,
  OutboundRefusedError,
  assertOutboundUrl,
  checkOutboundUrl,
  configureOutbound,
  isBlockedAddress,
  outboundReasonText,
  overrideOutboundResolver,
  type OutboundPolicy,
  type OutboundReason,
  type OutboundResolver,
} from "@storyshelf/common/http";
