/** How a capture child ended, as a phrase for logs and failure messages. */

/** An exit as `child_process` reports it: a code, or the signal that killed the child. */
export interface ChildExit {
  code: number | null;
  signal: string | null;
}

/** `signal SIGKILL` or `code 1`. */
export function describeExit(info: ChildExit): string {
  return info.signal ? `signal ${info.signal}` : `code ${info.code}`;
}
