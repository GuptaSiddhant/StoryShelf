/** Story-only signed-in accounts (fixed ids, example.test addresses, never a real domain). */
import type { AuthUser } from "@storyshelf/core/types";

/** A read-only shared demo account (#1274): signs in, signs out and reads, never writes. */
export const SHARED_READ_ONLY_ACCOUNT: AuthUser = {
  id: "01JD000000000000000000USRDEMO",
  email: "demo@example.test",
  name: "Demo",
  role: "member",
  readOnly: true,
};
