/** How a sign-in attempt that the engine did not accept is answered. */
export interface LoginFailure {
  /** The message on the sign-in page (generic either way: no user enumeration). */
  message: string;
  /** The status of the page answer. */
  status: 400 | 401 | 429 | 502;
  /** Whether admins opted into `sys:auth-failed` are told: credential failures only. */
  notify: boolean;
}

/**
 * The answer to an engine sign-in response that was not a 200. Rate-limit and upstream statuses
 * are propagated instead of being masked as 401, and they never raise the login-attempt signal:
 * only a credential failure does.
 */
export function loginFailureOf(engineStatus: number): LoginFailure {
  if (engineStatus === 429) {
    return { message: "Invalid credentials", status: 429, notify: false };
  }
  if (engineStatus >= 500) {
    return { message: "Invalid credentials", status: 502, notify: false };
  }
  if (engineStatus === 400) {
    return { message: "Enter a valid email address", status: 400, notify: false };
  }
  return { message: "Invalid credentials", status: 401, notify: true };
}
