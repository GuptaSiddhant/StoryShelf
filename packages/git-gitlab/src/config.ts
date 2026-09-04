import { z } from "zod";

/** Validation schema for the GitLab provider config (`owner` + `repo` + optional `host`). */
export const gitlabConfigSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  // oxlint-disable-next-line typescript/no-deprecated -- z.string().url() kept for zod v3 API compat
  host: z.string().url().optional(),
});
