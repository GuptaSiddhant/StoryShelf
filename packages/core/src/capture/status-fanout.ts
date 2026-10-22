import { LOCAL_SHA_PREFIX } from "@storyshelf/affected";
import type { Logger } from "pino";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { NotifierProvider } from "../adapters/notifier/provider.ts";
import { emitBuildState } from "../adapters/notifier/state.ts";
import type { NotificationChannel, NotifierState } from "../adapters/notifier/types.ts";
import {
  NotificationChannelModel,
  type NotificationChannelTables,
} from "../models/notification-channel.ts";
import type { Project } from "../schema/project.ts";
import type { SecretInput } from "../utils/encrypt.ts";

/** Name of the status a build's capture and review outcome is posted under (`<prefix>/testing`). */
const TESTING_STATUS = "testing";

/** Post a build's state (commit status and review comment) to every enabled git channel of its project. */
async function postStatusesForBuild(opts: {
  db: DatabaseAdapter;
  tables: NotificationChannelTables;
  project: Project;
  sha: string;
  status: NotifierState;
  url: string;
  notifiers: NotifierProvider[];
  secret: SecretInput;
  logger?: Logger;
}): Promise<void> {
  if (opts.notifiers.length === 0) {
    return;
  }
  if (opts.sha.startsWith(LOCAL_SHA_PREFIX)) {
    opts.logger?.info(
      { sha: opts.sha },
      "skipping git provider status for synthetic local identity",
    );
    return;
  }
  const model = new NotificationChannelModel(opts.db, opts.tables, opts.secret);
  const channels = await readableChannels(model, opts.project.id, opts.logger);
  await emitBuildState({
    notifiers: opts.notifiers,
    channels,
    sha: opts.sha,
    state: opts.status,
    url: opts.url,
    status: TESTING_STATUS,
    logger: opts.logger,
    onOutcome: async (outcome) => {
      await model.recordOutcome(outcome.channelId, outcome.error).catch((error: unknown) => {
        opts.logger?.warn({ err: error, channelId: outcome.channelId }, "failed to record outcome");
      });
    },
  });
}

/** The project's channels as send-ready views; a channel whose token cannot be decrypted is logged and skipped. */
async function readableChannels(
  model: NotificationChannelModel,
  projectId: string,
  logger: Logger | undefined,
): Promise<NotificationChannel[]> {
  const rows = await model.list(projectId);
  return rows.flatMap((row) => {
    const view = model.toView(row);
    if (view === null) {
      logger?.warn(
        { channelId: row.id, provider: row.provider },
        "failed to decrypt channel secret",
      );
    }
    return view === null ? [] : [view];
  });
}

export { postStatusesForBuild };
