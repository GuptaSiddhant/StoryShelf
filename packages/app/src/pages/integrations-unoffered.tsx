import type { HtmlEscapedString } from "hono/utils/html";
import { Alert } from "../ui/components.tsx";

/** An integration kind the server does not offer projects, with why (issue #1126). */
export interface UnofferedIntegrationView {
  kind: string;
  name: string;
  reason: string;
}

/**
 * The one line a site admin sees where a project's settings leave an integration out: what is
 * missing and a link to the System page. Project admins never see it (nothing is offered to them).
 */
export function UnofferedNotice(props: {
  area: string;
  integrations: readonly UnofferedIntegrationView[] | undefined;
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const integrations = props.integrations ?? [];
  if (integrations.length === 0) {
    return null;
  }
  const missing = integrations.map((entry) => `${entry.name} (${entry.reason})`).join("; ");
  return (
    <Alert tone="info">
      {props.area} not offered to projects on this server: {missing}. See{" "}
      <a href="/admin#integrations">System</a>.
    </Alert>
  );
}
