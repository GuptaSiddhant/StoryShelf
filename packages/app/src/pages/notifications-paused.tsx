import type { HtmlEscapedString } from "hono/utils/html";
import { Alert } from "../ui/components.tsx";

/** Notifications need a public URL, so without one nothing is sent (ADR 0014, decision 11). */
export function NotificationsPausedNotice(props: {
  paused: boolean | undefined;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  return props.paused ? (
    <Alert tone="warning" title="Notifications are paused">
      Notifications are paused until a public URL is set; set <code>PUBLIC_BASE_URL</code> or
      confirm the detected origin on the System page. Nothing is sent meanwhile, and no channel is
      marked as failing.
    </Alert>
  ) : null;
}
