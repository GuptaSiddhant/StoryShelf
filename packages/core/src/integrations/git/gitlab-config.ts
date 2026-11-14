import { z } from "zod";
import { statusPrefixSchema } from "./prefix.ts";

/** Validation schema for a GitLab channel config (`owner` + `repo`, optional `host` and status `prefix`). */
export const gitlabConfigSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  // oxlint-disable-next-line typescript/no-deprecated -- z.string().url() kept for zod v3 API compat
  host: z.string().url().optional(),
  prefix: statusPrefixSchema.optional(),
});
