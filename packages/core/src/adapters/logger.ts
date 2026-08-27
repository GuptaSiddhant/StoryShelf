/** Minimal structured logging abstraction. */
export interface LoggerAdapter {
  /** Log an informational message. */
  log(message: string, ...args: unknown[]): void;
  /** Log an error message. */
  error(message: string, ...args: unknown[]): void;
  /** Log a debug message, if debugging is supported. */
  debug?(message: string, ...args: unknown[]): void;
}
