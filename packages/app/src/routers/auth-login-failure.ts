/** How a sign-in attempt that the engine did not accept is answered. */
export interface LoginFailure {
  /** The message on the sign-in page (generic for credentials: no user enumeration). */
  message: string;
  /** The status of the page answer. */
  status: 400 | 401 | 403 | 429 | 502;
  /** Whether admins opted into `sys:auth-failed` are told: credential failures only. */
  notify: boolean;
  /**
   * The engine refused the address the page was opened at, not the credentials: the page names the
   * configured origin instead of `message` (#1431).
   */
  wrongAddress?: true;
}

/**
 * The engine's code for a sign-in whose `Origin` (or `Referer`) is not one it trusts. The engine
 * checks the origin before it reads the credentials, so this answer says nothing about the account.
 */
export const ENGINE_INVALID_ORIGIN = "INVALID_ORIGIN";

/**
 * The answer to an engine sign-in response that was not a 200. Rate-limit and upstream statuses
 * are propagated instead of being masked as 401, and they never raise the login-attempt signal:
 * only a credential failure does. A refused origin (`403` with {@link ENGINE_INVALID_ORIGIN}) is
 * not a credential failure: it gets its own answer and no signal.
 */
export function loginFailureOf(engineStatus: number, engineCode?: string): LoginFailure {
  if (engineStatus === 403 && engineCode === ENGINE_INVALID_ORIGIN) {
    return {
      message: "This page was opened at another address than the one the server is configured for",
      status: 403,
      notify: false,
      wrongAddress: true,
    };
  }
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

/** The `code` of an engine error answer (`{ code, message }`), or undefined when it has none. */
export async function engineErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "code" in body) {
      return typeof body.code === "string" ? body.code : undefined;
    }
  } catch {
    // Not JSON: no code.
  }
  return undefined;
}
