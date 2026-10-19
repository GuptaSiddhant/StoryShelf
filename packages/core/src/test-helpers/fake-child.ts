/** In-memory stand-ins for the forked capture channel, so queue tests need no real process. */
import type { ChildProcessHandle, ParentPort } from "../capture/forked/channel.ts";
import type { ChildMessage, ParentMessage } from "../capture/forked/protocol.ts";

/** A fake capture child: records what the parent sends, and lets a test play the child. */
export class FakeChild implements ChildProcessHandle {
  readonly sent: ParentMessage[] = [];
  killed = false;
  /** Whether the last kill was forced (SIGKILL). */
  forced = false;
  readonly #messageListeners: ((message: unknown) => void)[] = [];
  readonly #exitListeners: ((info: { code: number | null; signal: string | null }) => void)[] = [];

  send(message: ParentMessage): void {
    this.sent.push(message);
  }

  onMessage(listener: (message: unknown) => void): void {
    this.#messageListeners.push(listener);
  }

  onExit(listener: (info: { code: number | null; signal: string | null }) => void): void {
    this.#exitListeners.push(listener);
  }

  kill(force = false): void {
    this.killed = true;
    this.forced = force;
  }

  /** The child says something to the parent. */
  say(message: unknown): void {
    for (const listener of this.#messageListeners) {
      listener(message);
    }
  }

  /** The child process ends. */
  exit(code: number | null = 1, signal: string | null = null): void {
    for (const listener of this.#exitListeners) {
      listener({ code, signal });
    }
  }

  /** Jobs the parent has delivered so far. */
  delivered(): Extract<ParentMessage, { type: "job" }>[] {
    return this.sent.filter(
      (message): message is Extract<ParentMessage, { type: "job" }> => message.type === "job",
    );
  }
}

/** A child and its `ParentPort` wired to each other, as `process.send` would. */
export function linkedChannel(): { child: FakeChild; port: ParentPort; sever: () => void } {
  const child = new FakeChild();
  const parentListeners: (() => void)[] = [];
  const portListeners: ((message: unknown) => void)[] = [];
  child.send = (message: ParentMessage): void => {
    child.sent.push(message);
    for (const listener of portListeners) {
      listener(message);
    }
  };
  const port: ParentPort = {
    send: (message: ChildMessage): void => {
      child.say(message);
    },
    onMessage: (listener) => {
      portListeners.push(listener);
    },
    onDisconnect: (listener) => {
      parentListeners.push(listener);
    },
  };
  return {
    child,
    port,
    sever: () => {
      for (const listener of parentListeners) {
        listener();
      }
    },
  };
}
