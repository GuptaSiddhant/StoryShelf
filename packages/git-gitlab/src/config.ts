import { z } from "zod";

export const gitlabConfigSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  host: z.url().optional(),
});
