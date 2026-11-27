/**
 * Replace a per-project git channel with an approved repository link (ADR 0054, decision 8), in one
 * transaction: the new connection (when the channel's own App becomes one), the link, and the
 * channel's removal commit together or not at all. The channel is removed last, so a database
 * that cannot roll back still leaves it in place on any failure.
 */
import { and, eq } from "drizzle-orm";
import type { DatabaseAdapter, TxStore } from "../adapters/database.ts";
import type { StateOutputs } from "../adapters/notifier/outputs.ts";
import type { GitConnectionRow, GitRepositoryLinkRow } from "../schema/git-connection.ts";
import type { NotificationChannelRow } from "../schema/notification.ts";
import { col } from "./columns.ts";
import type { PerProjectGitChannel } from "./git-channel.ts";
import { channelKeyOf, sameLinkKey, type LinkKey } from "./git-link-key.ts";
import { newLinkRow, type GitLinkPins } from "./git-repository-link.ts";
import { GitRepositoryTakenError } from "./git-repository-taken-error.ts";

/** The channel is gone or changed since the site admin saw it: nothing was moved. */
export class GitChannelChangedError extends Error {
  constructor() {
    super("The git channel changed or was removed meanwhile; nothing was moved");
    this.name = "GitChannelChangedError";
  }
}

/** What one move writes. */
export interface ChannelReplacement {
  channel: PerProjectGitChannel;
  /** The connection the link goes through: an existing id, or a row to insert first. */
  connection: { id: string } | { row: GitConnectionRow };
  pins: GitLinkPins;
  outputs: StateOutputs;
  movedBy: string | null;
}

/**
 * Write the move: the channel must still be as it was read, and no link or other channel may hold
 * its repository and prefix.
 * @throws GitChannelChangedError when the channel moved meanwhile.
 * @throws GitRepositoryTakenError when the key is held elsewhere.
 */
export async function replaceChannelWithLink(
  db: DatabaseAdapter,
  move: ChannelReplacement,
): Promise<GitRepositoryLinkRow> {
  const run = async (store: TxStore): Promise<GitRepositoryLinkRow> => {
    await assertUnchanged(db, store, move.channel);
    await assertFree(db, store, move.channel);
    if ("row" in move.connection) {
      await store.insert(db.tables.gitConnections, move.connection.row);
    }
    const link = await insertLink(db, store, move);
    await store.remove(db.tables.notificationChannels, move.channel.id);
    return link;
  };
  return db.transact ? await db.transact(run) : await run(db);
}

async function insertLink(
  db: DatabaseAdapter,
  store: TxStore,
  move: ChannelReplacement,
): Promise<GitRepositoryLinkRow> {
  const { channel } = move;
  const connectionId = "row" in move.connection ? move.connection.row.id : move.connection.id;
  const row = newLinkRow(
    {
      projectId: channel.projectId,
      connectionId,
      requestedBy: move.movedBy ?? undefined,
      ...keyOf(channel),
    },
    keyOf(channel),
    { approvedBy: move.movedBy, pins: move.pins, outputs: move.outputs },
  );
  return (await store.insert(db.tables.gitRepositoryLinks, row)) as unknown as GitRepositoryLinkRow;
}

const keyOf = (channel: PerProjectGitChannel): LinkKey => ({
  host: channel.host,
  owner: channel.owner,
  repo: channel.repo,
  prefix: channel.prefix,
});

async function assertUnchanged(
  db: DatabaseAdapter,
  store: TxStore,
  channel: PerProjectGitChannel,
): Promise<void> {
  const row = (await store.get(
    db.tables.notificationChannels,
    channel.id,
  )) as unknown as NotificationChannelRow | null;
  if (row === null || row.updatedAt !== channel.updatedAt) {
    throw new GitChannelChangedError();
  }
}

async function assertFree(
  db: DatabaseAdapter,
  store: TxStore,
  channel: PerProjectGitChannel,
): Promise<void> {
  const key = keyOf(channel);
  const table = db.tables.gitRepositoryLinks;
  const links = (await store.list(table, {
    where: and(
      eq(col(table, "host"), key.host),
      eq(col(table, "owner"), key.owner),
      eq(col(table, "repo"), key.repo),
    ),
  })) as unknown as GitRepositoryLinkRow[];
  if (links.some((link) => sameLinkKey(key, link))) {
    throw new GitRepositoryTakenError("link");
  }
  const channels = (await store.list(
    db.tables.notificationChannels,
  )) as unknown as NotificationChannelRow[];
  const others = channels.filter((row) => row.id !== channel.id);
  if (others.some((row) => heldBy(row, key))) {
    throw new GitRepositoryTakenError("channel");
  }
}

function heldBy(row: NotificationChannelRow, key: LinkKey): boolean {
  const held = channelKeyOf(row);
  return held !== null && sameLinkKey(held, key);
}
