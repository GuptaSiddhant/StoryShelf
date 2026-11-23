/** A remote browser that went away in the middle of a capture pass. */

/**
 * The remote browser disconnected while a pass was running. Thrown once out of the pass (never
 * recorded as a story failure), so the job fails as a whole and the queue redelivers it; a new
 * attempt connects again. It carries no cause: a transport error can name the endpoint.
 */
export class RemoteBrowserLostError extends Error {
  override readonly name = "RemoteBrowserLostError";

  constructor() {
    super("The remote browser disconnected during the capture pass");
  }
}

/**
 * Whether the run's browser is gone. A cancel closes the browser itself, so a cancelled or aborted
 * run never reads as a loss: its own error ("Capture cancelled") stays the news.
 */
export function browserLost(
  remote: boolean,
  run: { cancelled: boolean; abort?: AbortController | undefined },
  isConnected: () => boolean,
): boolean {
  return remote && !run.cancelled && !run.abort?.signal.aborted && !isConnected();
}
