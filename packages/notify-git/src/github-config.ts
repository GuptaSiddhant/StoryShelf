import { z } from "zod";
import { statusPrefixSchema } from "./prefix.ts";

/** Validation schema for a GitHub channel config (`owner` + `repo`, optional status `prefix`). */
export const githubConfigSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  prefix: statusPrefixSchema.optional(),
});
