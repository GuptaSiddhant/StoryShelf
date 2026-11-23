/** A repository link cannot make the transition asked of it from the state it is in (ADR 0054). */
export class GitLinkStateError extends Error {
  readonly state: string | null;

  constructor(action: string, state: string | null) {
    super(
      state === null
        ? `Repository link not found (${action})`
        : `A ${state} repository link cannot be ${action}`,
    );
    this.name = "GitLinkStateError";
    this.state = state;
  }
}
