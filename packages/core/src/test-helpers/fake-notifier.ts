/** Fake `state` notifier (a git host stand-in) recording every state write. */
import { z } from "zod";
import type {
  SetStateInput,
  StateNotifierMetadata,
  StateNotifierProvider,
} from "../adapters/notifier/provider.ts";

/** A recording state provider and the writes it received. */
export interface FakeStateNotifier {
  provider: StateNotifierProvider;
  calls: SetStateInput[];
  /** Secrets `create` was bound with, in call order. */
  secrets: (string | undefined)[];
}

/**
 * Build a fake `state` provider of the given kind. `failWith` makes every write
 * reject with that message, like a host rejecting the token; `schema` is the
 * channel config schema (any object by default).
 */
export function makeFakeStateNotifier(
  kind = "fake-git",
  failWith?: string,
  schema: z.ZodType = z.object({}).loose(),
): FakeStateNotifier {
  const calls: SetStateInput[] = [];
  const secrets: (string | undefined)[] = [];
  const metadata: StateNotifierMetadata = {
    name: "Fake Git",
    version: "0.0.0",
    kind,
    category: "notifier",
    delivery: "state",
    schema,
  };
  const provider: StateNotifierProvider = {
    metadata,
    create: ({ secret }) => {
      secrets.push(secret);
      return {
        metadata,
        // oxlint-disable-next-line eslint/require-await -- setState is async by contract
        async setState(input: SetStateInput): Promise<void> {
          calls.push(input);
          if (failWith !== undefined) {
            throw new Error(failWith);
          }
        },
      };
    },
  };
  return { provider, calls, secrets };
}
