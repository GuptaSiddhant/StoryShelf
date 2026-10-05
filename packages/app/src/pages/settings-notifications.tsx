import type { Project } from "@storyshelf/core/schema";
import type { FC } from "hono/jsx";
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckField,
  Field,
  HStack,
  Meta,
  SectionTitle,
  SelectField,
  Table,
} from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";

/** Notification topic catalog (mirrors the webhook event names). */
export const NOTIFICATION_TOPICS: { event: string; label: string }[] = [
  { event: "build:created", label: "Build created" },
  { event: "build:reviewing", label: "Build needs review" },
  { event: "build:approved", label: "Build approved" },
  { event: "build:rejected", label: "Build rejected" },
  { event: "baseline:created", label: "Baseline created" },
  { event: "baseline:updated", label: "Baseline updated" },
  { event: "comment:created", label: "Comment posted" },
];

/** Channel row as rendered in the notifications settings tab. */
export interface SettingsNotificationChannel {
  id: string;
  provider: string;
  config: Record<string, unknown>;
  hasSecret: boolean;
  events: string[];
  enabled: boolean;
}

/** The viewer's own subscription for this project (null when opted out). */
export interface SettingsMySubscription {
  events: string[];
  via: string[];
  enabled: boolean;
}

/** Form state for the notifications tab (field errors, global error). */
export interface NotificationsFormState {
  errors?: Record<string, string>;
  globalError?: string;
}

/* eslint-disable promise-function-async -- JSX components return HtmlEscapedString */

/** Whether a topic checkbox renders checked (empty allowlist means all). */
function topicChecked(events: string[], event: string): boolean {
  return events.length === 0 || events.includes(event);
}

/** The viewer's own preferences card (visible to every member). */
const MyNotificationsCard: FC<{
  project: Project;
  mySubscription: SettingsMySubscription | null;
}> = ({ project, mySubscription }) => {
  const events = mySubscription?.events ?? [];
  return (
    <Card>
      <SectionTitle>My notifications for this project</SectionTitle>
      <Meta>Opt in to email alerts for this project. Leave everything off to stay silent.</Meta>
      <form
        method="post"
        action={`/projects/${project.slug}/settings/notifications/me`}
        hx-post={`/projects/${project.slug}/settings/notifications/me`}
        hx-target="body"
      >
        {csrfField()}
        <CheckField
          label="Email me about this project"
          name="enabled"
          checked={mySubscription?.enabled ?? false}
        />
        {NOTIFICATION_TOPICS.map((topic) => (
          <CheckField
            label={topic.label}
            name="events"
            value={topic.event}
            checked={topicChecked(events, topic.event)}
          />
        ))}
        <p>
          <Meta as="span">No boxes ticked means all topics.</Meta>
        </p>
        <Button variant="primary" type="submit">
          Save my preferences
        </Button>
      </form>
    </Card>
  );
};

/** Human-readable channel target (email address or masked webhook host). */
function targetOf(channel: SettingsNotificationChannel): string {
  const to = channel.config["to"];
  if (typeof to === "string" && to) {
    return to;
  }
  return channel.hasSecret ? `${channel.provider} webhook` : "—";
}

/** One channel table row with the admin delete action. */
const ChannelRow: FC<{ project: Project; channel: SettingsNotificationChannel }> = ({
  project,
  channel,
}) => (
  <tr>
    <td>
      <Badge tone="neutral">{channel.provider}</Badge>
    </td>
    <td class="truncate max-w-cell" title={targetOf(channel)}>
      {targetOf(channel)}
    </td>
    <td>
      {channel.events.length === 0 ? (
        <Meta as="span">all events</Meta>
      ) : (
        <HStack>
          {channel.events.map((event) => (
            <Badge tone="neutral">{event}</Badge>
          ))}
        </HStack>
      )}
    </td>
    <td>
      <form
        method="post"
        action={`/projects/${project.slug}/settings/notifications/${channel.id}/delete`}
        hx-post={`/projects/${project.slug}/settings/notifications/${channel.id}/delete`}
        hx-target="body"
      >
        {csrfField()}
        <Button variant="ghost" size="sm" type="submit">
          Delete
        </Button>
      </form>
    </td>
  </tr>
);

/** Channel list card (delete action renders for admins only). */
const ChannelsCard: FC<{
  project: Project;
  channels: SettingsNotificationChannel[];
  isAdmin: boolean;
}> = ({ project, channels, isAdmin }) => (
  <Card>
    <SectionTitle>Channels</SectionTitle>
    <Meta>
      Project admins route build events to Slack, Teams, or email. Secrets are stored encrypted and
      decrypted only in memory at send time.
    </Meta>
    <Table>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Target</th>
            <th>Events</th>
            <th>{isAdmin ? "" : null}</th>
          </tr>
        </thead>
        <tbody>
          {channels.map((channel) =>
            isAdmin ? (
              <ChannelRow project={project} channel={channel} />
            ) : (
              <tr key={channel.id}>
                <td>
                  <Badge tone="neutral">{channel.provider}</Badge>
                </td>
                <td class="truncate max-w-cell" title={targetOf(channel)}>
                  {targetOf(channel)}
                </td>
                <td>
                  <Meta as="span">
                    {channel.events.length === 0 ? "all events" : channel.events.join(", ")}
                  </Meta>
                </td>
                <td>{null}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </Table>
    {channels.length === 0 ? <Meta>No channels configured.</Meta> : null}
  </Card>
);

/** Channel creation card (admins only). */
const CreateChannelCard: FC<{
  project: Project;
  providers: string[];
  formState?: NotificationsFormState;
}> = ({ project, providers, formState }) => (
  <Card>
    <SectionTitle level={3}>Create channel</SectionTitle>
    <form
      method="post"
      action={`/projects/${project.slug}/settings/notifications`}
      hx-post={`/projects/${project.slug}/settings/notifications`}
      hx-target="body"
    >
      {csrfField()}
      <SelectField
        label="Provider"
        name="provider"
        options={providers.map((provider) => ({ value: provider, label: provider }))}
        hint={formState?.errors?.["provider"]}
      />
      <Field
        label="Target"
        name="target"
        type="text"
        required
        placeholder="team@example.com or https://hooks.slack.com/…"
        hint="Email address for email channels, webhook URL otherwise."
        error={formState?.errors?.["target"]}
      />
      <Field
        label="Events"
        name="events"
        placeholder="build.reviewing, build.approved"
        hint="Comma-separated. Leave blank to receive all events."
      />
      <SelectField
        label="Style"
        name="style"
        options={[
          { value: "compact", label: "Compact" },
          { value: "verbose", label: "Verbose" },
        ]}
      />
      <Button variant="primary" type="submit">
        Add channel
      </Button>
    </form>
  </Card>
);

/** Notifications settings tab: channel list, create form, and my preferences. */
export function renderSettingsNotifications(
  project: Project,
  channels: SettingsNotificationChannel[],
  providers: string[],
  mySubscription: SettingsMySubscription | null,
  isAdmin: boolean,
  formState?: NotificationsFormState,
): unknown {
  return (
    <div class="grid max-w-form">
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <MyNotificationsCard project={project} mySubscription={mySubscription} />
      <ChannelsCard project={project} channels={channels} isAdmin={isAdmin} />
      {isAdmin ? (
        <CreateChannelCard project={project} providers={providers} formState={formState} />
      ) : null}
    </div>
  );
}
