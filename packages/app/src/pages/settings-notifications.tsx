import type { Project } from "@storyshelf/core/schema";
import { NOTIFICATION_EVENTS } from "@storyshelf/core/utils";
import type { FC } from "hono/jsx";
import { csrfField } from "../shell/csrf-field.tsx";
import {
  Alert,
  Badge,
  Button,
  Card,
  HStack,
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
import { NotificationsPausedNotice } from "./notifications-paused.tsx";
import { CreateGitChannelCard } from "./settings-notifications-git.tsx";

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
  /** When a delivery last succeeded, null if none has. */
  lastDeliveredAt: string | null;
}

/** The viewer's own subscription for this project (null when opted out). */
export interface SettingsMySubscription {
  events: string[];
  via: string[];
  enabled: boolean;
  /** Whether `review:requested` reaches them (on unless they turned it off). */
  reviewRequests: boolean;
}

/** Form state for the notifications tab (field errors, global error). */
export interface NotificationsFormState {
  errors?: Record<string, string>;
  globalError?: string;
}

/* eslint-disable promise-function-async -- JSX components return HtmlEscapedString */

/** The one topic the "Send me review requests" switch controls, so it has no checkbox of its own. */
export const REVIEW_REQUESTED_EVENT = "review:requested";

/** The topics the card lists: every subscribable event but the one the review switch owns. */
export const LISTED_TOPICS = NOTIFICATION_EVENTS.filter(
  (entry) => entry.event !== REVIEW_REQUESTED_EVENT,
);

/** Whether a topic checkbox renders checked (empty allowlist means all). */
function topicChecked(events: string[], event: string): boolean {
  return events.length === 0 || events.includes(event);
}

/**
 * Whether the review-request switch shows on: the stored switch, and (for a subscription saved
 * before the switch owned the topic) a topic list that still admits it.
 */
function reviewRequestsOn(subscription: SettingsMySubscription | null): boolean {
  if (subscription === null) {
    return true;
  }
  const { events, reviewRequests } = subscription;
  return reviewRequests && (events.length === 0 || events.includes(REVIEW_REQUESTED_EVENT));
}

/** One checkbox per listed topic (an empty allowlist means all are ticked). */
const TopicChecks: FC<{ events: string[] }> = ({ events }) => (
  <>
    {LISTED_TOPICS.map((topic) => (
      <CheckField
        label={topic.label}
        name="events"
        value={topic.event}
        checked={topicChecked(events, topic.event)}
      />
    ))}
  </>
);

/** The viewer's own preferences card (visible to every member). */
const MyNotificationsCard: FC<{
  project: Project;
  mySubscription: SettingsMySubscription | null;
}> = ({ project, mySubscription }) => {
  const events = mySubscription?.events ?? [];
  const emailOff = mySubscription !== null && !mySubscription.enabled;
  return (
    <Card>
      <SectionTitle>My notifications for this project</SectionTitle>
      <Meta>
        Approvers and admins get review requests by email by default; turn off Send me review
        requests to stop them. The options below add other email alerts for this project.
      </Meta>
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
        <CheckField
          label="Send me review requests"
          name="reviewRequests"
          checked={reviewRequestsOn(mySubscription)}
          hint={
            emailOff
              ? "Email me is off, so no review requests reach you until you turn it on."
              : "Emails you when a build waits for a verdict. It changes nothing else below."
          }
        />
        <TopicChecks events={events} />
        <p>
          <Meta as="span">Ticking every box, or none, means all topics, including new ones.</Meta>
        </p>
        {project.reviewEnabled === false ? null : (
          <p>
            <Meta as="span">Reviews assigned to you as a component owner are always sent.</Meta>
          </p>
        )}
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

/** When a channel last delivered, or that it never has. */
const LastDelivered: FC<{ at: string | null }> = ({ at }) => (
  <Meta as="span">
    {at === null ? (
      "Never delivered"
    ) : (
      <>
        Last delivered <RelativeTime value={at} />
      </>
    )}
  </Meta>
);

/** The health badge: failing with its time and error, ok, or no delivery yet. */
const HealthStatus: FC<{ channel: SettingsNotificationChannel }> = ({ channel }) => {
  if (channel.lastError === null) {
    return channel.lastDeliveredAt === null ? (
      <Badge tone="neutral">no delivery yet</Badge>
    ) : (
      <Badge tone="success">ok</Badge>
    );
  }
  return (
    <>
      <Badge tone="danger">failing</Badge>
      <Meta as="span">
        Failed {channel.lastErrorAt ? <RelativeTime value={channel.lastErrorAt} /> : null}
        <span class="truncate max-w-cell" title={channel.lastError}>
          {" "}
          {channel.lastError}
        </span>
      </Meta>
    </>
  );
};

/** Delivery health, and when the channel last delivered. */
const ChannelHealth: FC<{ channel: SettingsNotificationChannel }> = ({ channel }) => (
  <VStack>
    <HealthStatus channel={channel} />
    <LastDelivered at={channel.lastDeliveredAt} />
  </VStack>
);

/** Git channels only, admins only: ask again for the open builds' state on this channel. Disabled while notifications are paused. */
const RetryForm: FC<{
  project: Project;
  channel: SettingsNotificationChannel;
  paused: boolean;
}> = ({ project, channel, paused }) => (
  <form
    method="post"
    action={`/projects/${project.slug}/settings/notifications/${channel.id}/retry`}
    hx-post={`/projects/${project.slug}/settings/notifications/${channel.id}/retry`}
    hx-target="body"
    hx-disabled-elt="find button"
  >
    {csrfField()}
    <HStack>
      <Button
        variant="secondary"
        size="sm"
        type="submit"
        disabled={paused}
        aria-label={`Retry current state of ${targetOf(channel)}`}
        aria-describedby={paused ? "notifications-paused" : undefined}
      >
        Retry current state
      </Button>
      {paused ? <Meta as="span">Paused: no confirmed public origin</Meta> : null}
    </HStack>
  </form>
);

/** The channel's delete action (admins only). */
const DeleteForm: FC<{ project: Project; channel: SettingsNotificationChannel }> = ({
  project,
  channel,
}) => (
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
);

/** One channel table row; Retry and Delete (admins only) sit side by side under the delivery content. */
const ChannelRow: FC<{
  project: Project;
  channel: SettingsNotificationChannel;
  isAdmin: boolean;
  paused: boolean;
}> = ({ project, channel, isAdmin, paused }) => (
  <tr key={channel.id} id={`channel-${channel.id}`} tabIndex={-1}>
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
      <VStack>
        <ChannelHealth channel={channel} />
        {isAdmin ? (
          <HStack>
            {channel.delivery === "state" && channel.enabled ? (
              <RetryForm project={project} channel={channel} paused={paused} />
            ) : null}
            <DeleteForm project={project} channel={channel} />
          </HStack>
        ) : null}
      </VStack>
    </td>
  </tr>
);

/** Channel list card: chat, email and git channels side by side, each with its delivery health. */
const ChannelsCard: FC<{
  project: Project;
  channels: SettingsNotificationChannel[];
  isAdmin: boolean;
  paused: boolean;
}> = ({ project, channels, isAdmin, paused }) => (
  <Card>
    <SectionTitle>Channels</SectionTitle>
    <Meta>
      Project admins route build events to Slack, Teams or email, and show each build's state on
      GitHub or GitLab as a commit status. Secrets and tokens are stored encrypted and decrypted
      only in memory at delivery time. Git channels follow the build state, not a topic list, and
      their delivery is best-effort: a failure shows here, and the next build state retries it.
    </Meta>
    {isAdmin && channels.some((channel) => channel.delivery === "state") ? (
      <Meta>
        Retry re-sends the current state of this project's open builds to one git channel. It never
        replays chat, email or webhooks.
      </Meta>
    ) : null}
    <Table label="Channels">
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Target</th>
            <th>Reacts to</th>
            <th>Delivery</th>
          </tr>
        </thead>
        <tbody>
          {channels.map((channel) => (
            <ChannelRow project={project} channel={channel} isAdmin={isAdmin} paused={paused} />
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
      <ChannelsCard
        project={project}
        channels={channels}
        isAdmin={isAdmin}
        paused={paused === true}
      />
      {isAdmin && messageProviders.length > 0 ? (
        <CreateChannelCard project={project} providers={messageProviders} formState={formState} />
      ) : null}
      {isAdmin && gitProviders.length > 0 ? (
        <CreateGitChannelCard project={project} providers={gitProviders} formState={formState} />
      ) : null}
    </div>
  );
}
