/** Shutdown handle for the observability SDK (see `node.ts`). */
export interface ObservabilityHandle {
  /** Whether the SDK is active (false = noop: no endpoint configured). */
  readonly enabled: boolean;
  /** Flush exporters and release SDK resources. Idempotent. */
  shutdown(): Promise<void>;
}
