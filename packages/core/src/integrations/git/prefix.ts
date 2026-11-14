import { z } from "zod";

/**
 * Status-name prefix of a git channel (`<prefix>/testing`). It forms part of the status
 * context on the host, so it is limited to characters both hosts accept in a name.
 */
export const statusPrefixSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\w.-]+$/u, "Use letters, digits, dots, dashes and underscores");
