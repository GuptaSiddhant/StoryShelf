import { stopAllAttempts } from "./remote-lease-attempt.ts";
/** Stopping everything remote the process holds, for a runner shutting down (ADR 0007, decision 4). */
import { releaseAllHeld } from "./remote-lease-held.ts";

const shutdownHooks = new Set<() => Promise<void>>();

/**
 * Stop everything remote this process holds, for a runner shutting down: abort pending `connect`
 * calls, release every lease still held as `cancelled`, then run the shutdown hooks (pools close
 * their resources). A server is not left running by a process that is gone.
 */
export async function shutdownRemote(): Promise<void> {
  stopAllAttempts();
  await releaseAllHeld();
  await Promise.all(
    [...shutdownHooks].map(async (hook) => {
      await hook();
    }),
  );
}

/** Run `hook` on shutdown; returns the function that unregisters it. */
export function onRemoteShutdown(hook: () => Promise<void>): () => void {
  shutdownHooks.add(hook);
  return () => {
    shutdownHooks.delete(hook);
  };
}
