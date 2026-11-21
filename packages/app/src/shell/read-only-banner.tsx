/** The quiet notice a read-only shared account sees on every app page (#1274). */
import type { FC } from "hono/jsx";
import { css } from "../ui/css.ts";
import { Alert } from "../ui/feedback.tsx";

/** The banner's title, the one line the issue fixes. */
export const READ_ONLY_BANNER_TITLE = "Shared demo account: read-only";

const readOnlyBanner = css`
  /* read-only-banner */
  margin-bottom: var(--space-4);
`;

/**
 * "Shared demo account: read-only", above the page content, for a read-only shared account only.
 * A status, not an alert: it is the same on every page and must not be announced on each.
 */
export const ReadOnlyBanner: FC<{ readOnly: boolean }> = ({ readOnly }) =>
  readOnly ? (
    <div class={readOnlyBanner} data-read-only-banner>
      <Alert tone="info" role="status" title={READ_ONLY_BANNER_TITLE}>
        Look around as much as you like. Changes are turned off for this account.
      </Alert>
    </div>
  ) : null;
