import { z } from "zod";

export const githubConfigSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});
