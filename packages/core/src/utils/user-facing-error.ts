/**
 * A refusal whose message was written for the person who sees it ("A label type with this key
 * already exists", "Invalid origin"). It is the only kind of error text a handler may put in a
 * response. Any other thrown value (a driver, storage or library failure) carries internal text
 * (SQL fragments, paths, hosts) and is answered with generic wording and logged instead.
 */
export class UserFacingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UserFacingError";
  }
}

/** Whether `error` is a {@link UserFacingError}, whose message is safe to show. */
export function isUserFacingError(error: unknown): error is UserFacingError {
  return error instanceof UserFacingError;
}
