/** The two ends of the parent/child channel, abstracted so queues are testable without a real process. */
import type { ChildMessage, ParentMessage } from "./protocol.ts";

/** How the parent sees the capture child (`child_process.fork` adapts to this). */
export interface ChildProcessHandle {
  send(message: ParentMessage): void;
  onMessage(listener: (message: unknown) => void): void;
  /** Fires once when the child ends; `code` is null when it was killed by a signal. */
  onExit(listener: (info: { code: number | null; signal: string | null }) => void): void;
  kill(): void;
}

/** How the child sees its parent (`process.send` / `process.on("message")` adapt to this). */
export interface ParentPort {
  send(message: ChildMessage): void;
  onMessage(listener: (message: unknown) => void): void;
  onDisconnect(listener: () => void): void;
}
