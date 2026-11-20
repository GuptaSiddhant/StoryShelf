import type { IntegrationState, IntegrationStatus } from "@storyshelf/core/integrations";
import type { HtmlEscapedString } from "hono/utils/html";
import { Badge, Card, Meta, SectionTitle, Table, VStack } from "../ui/components.tsx";

/** A stored channel the server does not deliver to, because its kind is not offered (issue #1126). */
export interface UndeliveredChannelView {
  id: string;
  provider: string;
  /** The owning project and its notification settings, or null for a site-wide channel. */
  project: { name: string; href: string } | null;
  reason: string;
}

/** What the System page shows about integrations. */
export interface IntegrationsView {
  statuses: readonly IntegrationStatus[];
  /** Channels kept but not delivered to while their kind is not offered. */
  channels: readonly UndeliveredChannelView[];
}

const STATE_LABEL: Record<IntegrationState, string> = {
  available: "available",
  unavailable: "unavailable",
  disabled: "turned off",
};

const STATE_TONE: Record<IntegrationState, "success" | "warning" | "neutral"> = {
  available: "success",
  unavailable: "warning",
  disabled: "neutral",
};

/** One integration kind: name, group and standing with its reason. */
function StatusRow(props: {
  status: IntegrationStatus;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { status } = props;
  return (
    <tr key={`${status.group}/${status.kind}`}>
      <td>
        <strong>{status.name}</strong>{" "}
        <Meta as="span" mono>
          {status.kind}
        </Meta>
      </td>
      <td>
        <Meta as="span">{status.group === "design" ? "design" : "notifications"}</Meta>
      </td>
      <td>
        <Badge tone={STATE_TONE[status.state]} icon>
          {STATE_LABEL[status.state]}
        </Badge>
        {status.reason === undefined ? null : <Meta as="div">{status.reason}</Meta>}
      </td>
    </tr>
  );
}

/** The channels a project admin no longer sees, so nothing goes silent unseen. */
function UndeliveredChannels(props: {
  channels: readonly UndeliveredChannelView[];
}): HtmlEscapedString | Promise<HtmlEscapedString> | null {
  const { channels } = props;
  if (channels.length === 0) {
    return null;
  }
  return (
    <div class="mt-1">
      <VStack>
        <SectionTitle level={3}>Channels not delivered to</SectionTitle>
        <Meta>
          These channels are kept, but hidden from their project and not delivered to while their
          integration is not offered. Turning it back on brings them back.
        </Meta>
        <Table label="Channels not delivered to">
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Provider</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((channel) => (
                <tr key={channel.id}>
                  <td>
                    {channel.project === null ? (
                      <Meta as="span">site-wide</Meta>
                    ) : (
                      <a href={channel.project.href}>{channel.project.name}</a>
                    )}
                  </td>
                  <td>
                    <Badge tone="neutral">{channel.provider}</Badge>
                  </td>
                  <td>
                    <Meta as="span">{channel.reason}</Meta>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Table>
      </VStack>
    </div>
  );
}

/**
 * Every integration kind and whether projects are offered it (issue #1126): available, unavailable
 * with the reason, or turned off by the operator. Lists the channels that are not delivered to.
 */
export function IntegrationsCard(props: {
  view: IntegrationsView;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { statuses, channels } = props.view;
  return (
    <Card>
      <SectionTitle>Integrations</SectionTitle>
      <Meta>
        Projects are offered only the available ones. Turn one off with{" "}
        <code>SHELF_INTEGRATIONS_DISABLED</code> or the <code>notifications.notifiers</code> and{" "}
        <code>design</code> options.
      </Meta>
      <Table label="Integrations">
        <table>
          <thead>
            <tr>
              <th>Integration</th>
              <th>Area</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((status) => (
              <StatusRow status={status} />
            ))}
          </tbody>
        </table>
      </Table>
      <UndeliveredChannels channels={channels} />
    </Card>
  );
}
