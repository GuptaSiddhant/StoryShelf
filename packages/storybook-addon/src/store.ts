/** A one-value store the sidebar labels subscribe to: the status arrives after the labels first render. */
import type { StoryStatusBody } from "./types.ts";

/** What the labels need once the answer is in: the status and the review link. */
export interface BadgeState {
  status: StoryStatusBody;
  reviewUrl: string;
}

/** Subscribe-and-read shape React's `useSyncExternalStore` takes. */
export interface BadgeStore {
  get(): BadgeState | null;
  set(state: BadgeState): void;
  subscribe(listener: () => void): () => void;
}

/** An empty store; `get` returns the same object until `set` is called. */
export function createBadgeStore(): BadgeStore {
  let current: BadgeState | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (state) => {
      current = state;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
