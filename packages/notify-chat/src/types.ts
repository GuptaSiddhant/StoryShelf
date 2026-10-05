import { z } from "zod";

/** Display toggles shared by chat providers (Brand + toggles v1). */
export const chatTogglesSchema = z.object({
  style: z.enum(["compact", "verbose"]).optional(),
  subjectPrefix: z.string().min(1).optional(),
  includeAuthor: z.boolean().optional(),
  includeMessage: z.boolean().optional(),
  includeCounts: z.boolean().optional(),
  username: z.string().min(1).optional(),
});

/** Display toggles shared by chat providers. */
export type ChatToggles = z.infer<typeof chatTogglesSchema>;
