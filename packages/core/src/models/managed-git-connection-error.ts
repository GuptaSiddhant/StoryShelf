/** Thrown when the UI or API tries to change a git connection that configuration manages. */
export class ManagedGitConnectionError extends Error {
  readonly connectionId: string;

  constructor(connectionId: string) {
    super(`Git connection "${connectionId}" is managed by configuration; change it there`);
    this.name = "ManagedGitConnectionError";
    this.connectionId = connectionId;
  }
}
