/**
 * "Retry current state" for one git channel (#265): ask again for the open builds of the channel's
 * project, to that channel only. Never chat, email, webhooks or alerts. Shared by the JSON route
 * and the settings form so both refuse in the same way.
 */
import { NotificationChannelModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import { requestChannelStateNow } from "../git-status.ts";
import { NOTIFICATIONS_PAUSED_TEXT, notificationsPaused } from "../notifications-pause.ts";
import { getStore } from "../store.ts";
import { notificationChannelModel } from "./scoped-models.ts";

/** What a retry did, or why it refused (`status` is the HTTP answer). */
export type ChannelRetryResult =
  | { ok: true; asked: number }
  | { ok: false; status: 400 | 404 | 409; message: string };

/** Re-request the current state of `project`'s open builds on one of its git channels. */
export async function retryChannelState(
  project: Pick<Project, "id">,
  channelId: string,
): Promise<ChannelRetryResult> {
  const channel = await notificationChannelModel().get(channelId);
  if (channel?.projectId !== project.id) {
    return { ok: false, status: 404, message: "Notification channel not found" };
  }
  if (!NotificationChannelModel.isStateKind(getStore().notifiers, channel.provider)) {
    return { ok: false, status: 400, message: "Only git channels show a build's current state" };
  }
  if (await notificationsPaused()) {
    return { ok: false, status: 409, message: NOTIFICATIONS_PAUSED_TEXT };
  }
  return { ok: true, asked: await requestChannelStateNow({ projectId: project.id, channelId }) };
}
