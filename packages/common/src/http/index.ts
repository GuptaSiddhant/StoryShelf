/**
 * Outbound HTTP: `httpJson` and friends over a guarded `fetch` that refuses private addresses and
 * unsafe redirects, with retries, tracing and redaction. The one way StoryShelf calls out.
 */
export { HttpError, httpBytes, httpJson, httpStatus, httpText } from "./http.ts";
export type { HttpRequestOptions, HttpTextOptions } from "./http.ts";
export { redactUrlForLog } from "../redact/redact.ts";
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
} from "./outbound.ts";
export { guardedFetch, overrideGuardedNetwork, type GuardedInit } from "./outbound-fetch.ts";
