/**
 * `config.storybookHosting` (ADR 0051, decision 1): the type, its schema and the rules that need no
 * other option. Re-exported through `@storyshelf/core/config`. The checks that need the whole option
 * set (sign-in on, a secret) live in `options.ts`.
 */
import { z } from "zod";

/** How published Storybooks are hosted. */
export type StorybookHostingMode = "trusted" | "sandboxed" | "subdomain";

/** `config.storybookHosting`. */
export interface StorybookHostingConfig {
  mode: StorybookHostingMode;
  /** The domain content hosts live under; `subdomain` only. */
  baseDomain?: string;
}

/** A DNS label: letters, digits and inner hyphens, at most 63 characters. */
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

/**
 * Schema of `storybookHosting`: a strict object, so a key other than `mode` and `baseDomain` is
 * refused. The `baseDomain` rules are in {@link validateStorybookHosting}.
 */
export const storybookHostingSchema: z.ZodType<StorybookHostingConfig> = z
  .object({
    mode: z.enum(["trusted", "sandboxed", "subdomain"]),
    baseDomain: z.string().optional(),
  })
  .strict();

/**
 * `baseDomain` lower-cased with one trailing dot dropped, or the reason it is refused: a port, a
 * scheme, a wildcard or any label that is not a valid DNS label.
 */
export function normalizeBaseDomain(value: string): { ok: true; value: string } | { ok: false } {
  const domain = value.toLowerCase().replace(/\.$/u, "");
  const labels = domain.split(".");
  const valid = domain !== "" && labels.every((label) => DNS_LABEL.test(label));
  return valid ? { ok: true, value: domain } : { ok: false };
}

/**
 * The rules of decision 1 that depend on this object alone: `baseDomain` belongs to `subdomain`
 * and is required there, and it must be a clean domain. Returns the config with `baseDomain`
 * normalized, or throws with the reason. A value that fails never falls back to `trusted`.
 */
export function validateStorybookHosting(hosting: StorybookHostingConfig): StorybookHostingConfig {
  if (hosting.mode !== "subdomain") {
    if (hosting.baseDomain !== undefined) {
      throw new Error(`storybookHosting.baseDomain is only for the "subdomain" mode`);
    }
    return hosting;
  }
  if (hosting.baseDomain === undefined) {
    throw new Error(`storybookHosting.baseDomain is required for the "subdomain" mode`);
  }
  const domain = normalizeBaseDomain(hosting.baseDomain);
  if (!domain.ok) {
    throw new Error(
      "storybookHosting.baseDomain must be a plain domain such as shelf.example.com: no scheme, port or wildcard, and every label a valid DNS label",
    );
  }
  return { mode: "subdomain", baseDomain: domain.value };
}
