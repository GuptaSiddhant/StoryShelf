/** Errors of the repository link model. */

/** The repository and prefix on a host are already linked, by a link or by a project's git channel. */
export class GitRepositoryTakenError extends Error {
  readonly takenBy: "link" | "channel";

  constructor(takenBy: "link" | "channel") {
    super(`That repository and status prefix are already used by a project's git ${takenBy}`);
    this.name = "GitRepositoryTakenError";
    this.takenBy = takenBy;
  }
}
