/** The signals a platform sends to stop a process: SIGTERM (Fly, ECS, Kubernetes), SIGINT (Ctrl-C). */
export const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

/**
 * Call `handler` on SIGINT or SIGTERM until the returned function is called; that function removes
 * exactly the listeners added here, and nothing another module registered.
 */
export function onShutdownSignals(handler: (signal: ShutdownSignal) => void): () => void {
  const added = SHUTDOWN_SIGNALS.map((signal) => {
    const listener = (): void => {
      handler(signal);
    };
    process.on(signal, listener);
    return { signal, listener };
  });
  return () => {
    for (const { signal, listener } of added) {
      process.off(signal, listener);
    }
  };
}
