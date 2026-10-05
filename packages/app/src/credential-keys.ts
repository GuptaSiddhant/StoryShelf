import type { ShelfConfig } from "@storyshelf/core/config";
import type { SecretInput } from "@storyshelf/core/utils";

/**
 * Key material for encrypted credentials: the current secret, plus
 * `previousSecret` as a decrypt-only fallback during a rotation. Not for
 * signing (CSRF, sessions), which only ever uses `config.secret`.
 */
export function credentialKeys(config: ShelfConfig): SecretInput {
  if (config.secret && config.previousSecret) {
    return { current: config.secret, previous: config.previousSecret };
  }
  return config.secret;
}
