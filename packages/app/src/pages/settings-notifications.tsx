import type { Project } from "@storyshelf/core/schema";
import { NOTIFICATION_EVENTS } from "@storyshelf/core/utils";
import type { FC } from "hono/jsx";
import { csrfField } from "../shell/csrf-field.tsx";
import {
  Alert,
  Button,
  Card,
  DialogLink,
  HStack,
  CheckField,
  FormActions,
  Meta,
  SectionTitle,
  SummaryList,
  VStack,
  formatAbsolute,
  statusLabel,
  type SummaryItem,
  Form,
} from "../ui/components.tsx";
import { ADD_CHANNEL_DIALOG, EDIT_CHANNEL_DIALOG, type ChannelKind } from "./channel-forms.tsx";
import { FormDialog } from "./dialog-form.tsx";
import { UnofferedNotice, type UnofferedIntegrationView } from "./integrations-unoffered.tsx";
import { NotificationsPausedNotice } from "./notifications-paused.tsx";
import { ProjectGitChannelsNotice } from "./settings-notifications-git.tsx";

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
      <Form
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
          <Button variant="primary" type="submit">
            Save my preferences
          </Button>
        </FormActions>
      </Form>
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
    <Button variant="danger-secondary" size="sm" type="submit">
      Delete
    </Button>
  </form>
);

/** The channel's health as the summary's state badge. */
function healthOf(channel: SettingsNotificationChannel): NonNullable<SummaryItem["state"]> {
  if (channel.lastError !== null) {
    return { label: "Failing", tone: "danger" };
  }
  return channel.lastDeliveredAt === null
    ? { label: "No delivery yet", tone: "neutral" }
    : { label: "OK", tone: "success" };
}

/** The last outcome as text: the failure with its day, the last delivery, or never. */
function lastOutcome(channel: SettingsNotificationChannel): string {
  if (channel.lastError === null) {
    return channel.lastDeliveredAt === null
      ? "Never delivered"
      : `Last delivered ${formatAbsolute(channel.lastDeliveredAt, "date")}`;
  }
  const when = channel.lastErrorAt ? ` ${formatAbsolute(channel.lastErrorAt, "date")}` : "";
  return `Failed${when}: ${channel.lastError}`;
}

/** Provider, what it reacts to and its last delivery or error, as one line. */
function detailsOf(channel: SettingsNotificationChannel): string {
  return [statusLabel(channel.provider), reactsTo(channel), lastOutcome(channel)].join(" · ");
}

/** A channel's actions (admins only): Edit for message channels, Retry for git ones, Delete. */
const ChannelActions: FC<{
  project: Project;
  channel: SettingsNotificationChannel;
  paused: boolean;
}> = ({ project, channel, paused }) => (
  <HStack>
    {channel.delivery === "message" ? (
      <DialogLink
        dialogId={EDIT_CHANNEL_DIALOG}
        href={`/projects/${project.slug}/settings/notifications/${channel.id}/edit`}
        variant="secondary"
        size="sm"
        aria-label={`Edit ${targetOf(channel)}`}
      >
        Edit
      </DialogLink>
    ) : null}
    {channel.delivery === "state" && channel.enabled ? (
      <RetryForm project={project} channel={channel} paused={paused} />
    ) : null}
    <DeleteForm project={project} channel={channel} />
  </HStack>
);

const AddChannelLink: FC<{ project: Project; primary: boolean }> = ({ project, primary }) => (
  <DialogLink
    dialogId={ADD_CHANNEL_DIALOG}
    href={`/projects/${project.slug}/settings/notifications/new`}
    variant={primary ? "primary" : "secondary"}
    size={primary ? "md" : "sm"}
    icon="plus"
  >
    Add channel
  </DialogLink>
);

const ChannelDialogs: FC = () => (
  <>
    <FormDialog id={ADD_CHANNEL_DIALOG} title="Add channel" submitLabel="Add channel" />
    <FormDialog id={EDIT_CHANNEL_DIALOG} title="Edit channel" submitLabel="Save channel" />
  </>
);

/** Channels as a summary: chat, email and git channels side by side, each with its delivery health. */
const ChannelsSection: FC<{
  project: Project;
  channels: SettingsNotificationChannel[];
  messageKinds: ChannelKind[];
  isAdmin: boolean;
  paused: boolean;
}> = ({ project, channels, messageKinds, isAdmin, paused }) => {
  const canAdd = isAdmin && messageKinds.length > 0;
  const add = (primary: boolean): unknown =>
    canAdd ? <AddChannelLink project={project} primary={primary} /> : undefined;
  return (
    <VStack gap="lg">
      <Card>
        <SectionTitle actions={channels.length > 0 ? add(false) : null}>Channels</SectionTitle>
        <Meta>
          Project admins route build events to Slack, Teams or email, and show each build's state on
          GitHub or GitLab as a commit status. Secrets and tokens are stored encrypted and decrypted
          only in memory at delivery time. Git channels follow the build state, not a topic list,
          and their delivery is best-effort: a failure shows here, and the next build state retries
          it.
        </Meta>
        {isAdmin && channels.some((channel) => channel.delivery === "state") ? (
          <Meta>
            Retry re-sends the current state of this project's open builds to one git channel. It
            never replays chat, email or webhooks.
          </Meta>
        ) : null}
        <SummaryList
          label="Channels"
          items={channels.map((channel) => ({
            id: channel.id,
            anchor: `channel-${channel.id}`,
            name: targetOf(channel),
            state: healthOf(channel),
            details: detailsOf(channel),
            actions: isAdmin ? (
              <ChannelActions project={project} channel={channel} paused={paused} />
            ) : undefined,
          }))}
          emptyTitle="No channels configured"
          add={add(true)}
        />
      </Card>
      {canAdd ? <ChannelDialogs /> : null}
    </VStack>
  );
};

/**
 * Notifications settings tab: channel list, create forms, and my preferences. Only the providers the
 * server offers are listed (issue #1126); with none, a site admin sees one line naming what is
 * missing (`unoffered`, site admins only) and a project admin sees nothing.
 */
export function renderSettingsNotifications(
  project: Project,
  channels: SettingsNotificationChannel[],
  providers: SettingsNotifyProvider[],
  mySubscription: SettingsMySubscription | null,
  isAdmin: boolean,
  formState?: NotificationsFormState,
  paused?: boolean,
  unoffered?: readonly UnofferedIntegrationView[],
): unknown {
  if (providers.length === 0) {
    // A refused form (a stale page posting a kind no longer offered) still says why.
    const refusal = formState?.globalError ?? formState?.errors?.["provider"];
    return (
      <>
        {refusal ? <Alert tone="danger">{refusal}</Alert> : null}
        <UnofferedNotice area="Notifications are" integrations={unoffered} />
      </>
    );
  }
  const messageProviders = providers.filter((provider) => provider.delivery === "message");
  const gitProviders = providers.filter((provider) => provider.delivery === "state");
  const gitChannels = channels.filter((channel) => channel.delivery === "state").length;
  // The personal card's switches are about email: it shows only while email is offered.
  const personal = providers.some((provider) => provider.kind === "email");
  return (
    <VStack gap="lg">
      <UnofferedNotice area="Some integrations are" integrations={unoffered} />
      <NotificationsPausedNotice paused={paused} />
      {gitProviders.length > 0 && (isAdmin || gitChannels > 0) ? (
        <ProjectGitChannelsNotice project={project} channels={gitChannels} />
      ) : null}
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      {personal ? <MyNotificationsCard project={project} mySubscription={mySubscription} /> : null}
      <ChannelsSection
        project={project}
        channels={channels}
        messageKinds={messageProviders.map(({ kind, name }) => ({ kind, name }))}
        isAdmin={isAdmin}
        paused={paused === true}
      />
    </VStack>
  );
}
