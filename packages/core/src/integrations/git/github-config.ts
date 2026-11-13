import { z } from "zod";
import { statusPrefixSchema } from "./prefix.ts";

/**
 * Validation schema for a GitHub channel config: `owner` + `repo`, an optional status `prefix` and
 * how the build is shown. `statuses` (default) posts commit statuses with a token; `checks` posts
 * check runs as a GitHub App and needs `appId` and `installationId` (the private key is the
 * channel's secret).
 */
export const githubConfigSchema = z
  .object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    prefix: statusPrefixSchema.optional(),
    mode: z.enum(["statuses", "checks"]).optional(),
    appId: z.string().regex(/^\d+$/u, "Use the numeric App ID").optional(),
    installationId: z.string().regex(/^\d+$/u, "Use the numeric installation ID").optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.mode !== "checks") {
      return;
    }
    for (const field of ["appId", "installationId"] as const) {
      if (cfg[field] === undefined) {
        ctx.addIssue({ code: "custom", path: [field], message: `Checks mode needs ${field}` });
      }
    }
  });

/** The parsed config of a GitHub channel. */
export type GitHubConfig = z.infer<typeof githubConfigSchema>;
