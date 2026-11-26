/** Errors that carry text safe to show a user, and the helpers that turn any thrown value into text. */
export { errorMessage, errorText, type ErrorTextOptions } from "./error-text.ts";
export { UserFacingError, isUserFacingError } from "./user-facing-error.ts";
export {
  failureDetail,
  failureText,
  type FailureDetail,
  type FailureDetailOptions,
  type FailureLink,
} from "./failure-detail.ts";
