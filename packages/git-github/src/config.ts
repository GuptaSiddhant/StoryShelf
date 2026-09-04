import { z } from "zod";

/** Validation schema for the GitHub provider config (`owner` + `repo`). */
export const githubConfigSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});
