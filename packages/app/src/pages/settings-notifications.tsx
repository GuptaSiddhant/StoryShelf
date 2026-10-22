import type { Project } from "@storyshelf/core/schema";
import type { FC } from "hono/jsx";
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckField,
  Field,
  FormActions,
  Meta,
  RelativeTime,
  SectionTitle,
  SelectField,
  Table,
  VStack,
} from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";
import { NotificationsPausedNotice } from "./notifications-paused.tsx";
import { CreateGitChannelCard } from "./settings-notifications-git.tsx";

/** Notification topic catalog (mirrors the webhook event names). */
export const NOTIFICATION_TOPICS: { event: string; label: string }[] = [
  { event: "build:created", label: "Build created" },
  { event: "build:reviewing", label: "Build needs review" },
  { event: "build:approved", label: "Build approved" },
  { event: "build:rejected", label: "Build rejected" },
  { event: "build:pending", label: "Build sent back to pending" },
  { event: "build:cancelled", label: "Build cancelled" },
  { event: "baseline:created", label: "Baseline created" },
  { event: "baseline:updated", label: "Baseline updated" },
  { event: "comment:created", label: "Comment posted" },
];

/** A wired provider as offered by the create forms. */
export interface SettingsNotifyProvider {
  kind: string;
  name: string;
  /** `message` providers send a message once; `state` providers (git hosts) show a build's state. */
  delivery: "message" | "state";
}

/** Channel row as rendered in the notifications settings tab. */
export interface SettingsNotificationChannel {
  id: string;
  provider: string;
  delivery: "message" | "state";
  config: Record<string, unknown>;
  hasSecret: boolean;
  events: string[];
  enabled: boolean;
  /** Last delivery error, null while the channel delivers cleanly. */
  lastError: string | null;
  lastErrorAt: string | null;
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
        <FormActions>
          <Button variant="primary" type="submit" icon="check">
            Save my preferences
          </Button>
        </FormActions>
      </form>
    </Card>
  );
};

/** A config value as text; anything but a string reads as empty. */
function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Human-readable channel target (git repository, email address or masked webhook host). */
function targetOf(channel: SettingsNotificationChannel): string {
  if (channel.delivery === "state") {
    const where = `${textOf(channel.config["owner"])}/${textOf(channel.config["repo"])}`;
    const prefix = textOf(channel.config["prefix"]);
    return prefix ? `${where} (${prefix})` : where;
  }
  const to = channel.config["to"];
  if (typeof to === "string" && to) {
    return to;
  }
  return channel.hasSecret ? `${channel.provider} webhook` : "—";
}

/** What a channel reacts to: its topic filter, or the build state for git channels. */
function reactsTo(channel: SettingsNotificationChannel): string {
  if (channel.delivery === "state") {
    return "build state";
  }
  return channel.events.length === 0 ? "all events" : channel.events.join(", ");
}

/** Delivery health: failing with the last error and time, or ok. */
const ChannelHealth: FC<{ channel: SettingsNotificationChannel }> = ({ channel }) =>
  channel.lastError === null ? (
    <Badge tone="success">ok</Badge>
  ) : (
    <VStack>
      <Badge tone="danger">failing</Badge>
      <Meta as="span">
        <span class="truncate max-w-cell" title={channel.lastError}>
          {channel.lastError}
        </span>
        {channel.lastErrorAt ? <RelativeTime value={channel.lastErrorAt} /> : null}
      </Meta>
    </VStack>
  );

/** One channel table row; the delete action renders for admins only. */
const ChannelRow: FC<{
  project: Project;
  channel: SettingsNotificationChannel;
  isAdmin: boolean;
}> = ({ project, channel, isAdmin }) => (
  <tr key={channel.id}>
    <td>
      <Badge tone="neutral">{channel.provider}</Badge>
    </td>
    <td class="truncate max-w-cell" title={targetOf(channel)}>
      {targetOf(channel)}
    </td>
    <td>
      <Meta as="span">{reactsTo(channel)}</Meta>
    </td>
    <td>
      <ChannelHealth channel={channel} />
    </td>
    <td>
      {isAdmin ? (
        <form
          method="post"
          action={`/projects/${project.slug}/settings/notifications/${channel.id}/delete`}
          hx-post={`/projects/${project.slug}/settings/notifications/${channel.id}/delete`}
          hx-target="body"
          hx-confirm="Remove this channel?"
        >
          {csrfField()}
          <Button variant="ghost" size="sm" type="submit">
            Delete
          </Button>
        </form>
      ) : null}
    </td>
  </tr>
);

/** Channel list card: chat, email and git channels side by side, each with its delivery health. */
const ChannelsCard: FC<{
  project: Project;
  channels: SettingsNotificationChannel[];
  isAdmin: boolean;
}> = ({ project, channels, isAdmin }) => (
  <Card>
    <SectionTitle>Channels</SectionTitle>
    <Meta>
      Project admins route build events to Slack, Teams or email, and show each build's state on
      GitHub or GitLab as a commit status. Secrets and tokens are stored encrypted and decrypted
      only in memory at delivery time. Git channels follow the build state, not a topic list, and
      their delivery is best-effort: a failure shows here, and the next build state retries it.
    </Meta>
    <Table>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Target</th>
            <th>Reacts to</th>
            <th>Delivery</th>
            <th>
              <span class="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {channels.map((channel) => (
            <ChannelRow project={project} channel={channel} isAdmin={isAdmin} />
          ))}
        </tbody>
      </table>
    </Table>
    {channels.length === 0 ? <Meta>No channels configured.</Meta> : null}
  </Card>
);

/** Channel creation card (admins only). */
const CreateChannelCard: FC<{
  project: Project;
  providers: SettingsNotifyProvider[];
  formState?: NotificationsFormState;
}> = ({ project, providers, formState }) => (
  <Card>
    <SectionTitle level={3}>Add a message channel</SectionTitle>
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
        options={providers.map((provider) => ({ value: provider.kind, label: provider.name }))}
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
      <FormActions>
        <Button variant="primary" type="submit" icon="plus">
          Add channel
        </Button>
      </FormActions>
    </form>
  </Card>
);

/** Notifications settings tab: channel list, create forms, and my preferences. */
export function renderSettingsNotifications(
  project: Project,
  channels: SettingsNotificationChannel[],
  providers: SettingsNotifyProvider[],
  mySubscription: SettingsMySubscription | null,
  isAdmin: boolean,
  formState?: NotificationsFormState,
  paused?: boolean,
): unknown {
  const messageProviders = providers.filter((provider) => provider.delivery === "message");
  const gitProviders = providers.filter((provider) => provider.delivery === "state");
  return (
    <div class="grid max-w-form">
      <NotificationsPausedNotice paused={paused} />
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <MyNotificationsCard project={project} mySubscription={mySubscription} />
      <ChannelsCard project={project} channels={channels} isAdmin={isAdmin} />
      {isAdmin && messageProviders.length > 0 ? (
        <CreateChannelCard project={project} providers={messageProviders} formState={formState} />
      ) : null}
      {isAdmin && gitProviders.length > 0 ? (
        <CreateGitChannelCard project={project} providers={gitProviders} formState={formState} />
      ) : null}
    </div>
  );
}
