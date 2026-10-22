/** Shared set-up of the build-state tests: a project with a build and one git channel on the fake database. */
import type { DatabaseAdapter } from "../../adapters/database.ts";
import type { StateNotifierProvider } from "../../adapters/notifier/provider.ts";
import type { StorageAdapter } from "../../adapters/storage.ts";
import { createShelfLogger } from "../../logger.ts";
import { BuildModel } from "../../models/build.ts";
import { NotificationChannelModel } from "../../models/notification-channel.ts";
import { ProjectModel } from "../../models/project.ts";
import type { Build } from "../../schema/build.ts";
import type { Project } from "../../schema/project.ts";
import { makeStorage } from "../../test-helpers/fake-adapters.ts";
import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { makeFakeStateNotifier, type FakeStateNotifier } from "../../test-helpers/fake-notifier.ts";
import type { BuildStateDeps } from "./types.ts";

export const SECRET = "test-secret-0123456789abcdef";

export interface World {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  project: Project;
  build: Build;
  channelId: string;
  git: FakeStateNotifier;
  /** While set, every state write rejects with this message. */
  failure: { message: string | null };
  deps: BuildStateDeps;
  builds: BuildModel;
  channels: NotificationChannelModel;
}

/** One project, one build (`pending`, sha `abc123`), one enabled `fake-git` channel. */
export async function world(
  options: { db?: DatabaseAdapter; config?: Record<string, unknown> } = {},
): Promise<World> {
  const db = options.db ?? makeDatabase().db;
  const seeded = await seed(db, options.config ?? {});
  const git = makeFakeStateNotifier();
  const failure: World["failure"] = { message: null };
  const { storage } = makeStorage();
  const deps = depsOf({ db, storage, provider: switchable(git, failure) });
  return { db, storage, git, failure, deps, ...seeded };
}

async function seed(
  db: DatabaseAdapter,
  config: Record<string, unknown>,
): Promise<Pick<World, "project" | "build" | "channelId" | "builds" | "channels">> {
  const project = await new ProjectModel(db).create({ name: "Web" });
  const builds = new BuildModel(db);
  const build = await builds.create(project.id, { gitSha: "abc123", gitBranch: "feature/x" });
  const channels = new NotificationChannelModel(db, undefined, SECRET);
  const row = await channels.create({
    projectId: project.id,
    provider: "fake-git",
    config,
    secret: "ghp_token",
  });
  return { project, build, channelId: row.id, builds, channels };
}

/** The fake provider, rejecting every write while `failure.message` is set. */
function switchable(git: FakeStateNotifier, failure: World["failure"]): StateNotifierProvider {
  return {
    ...git.provider,
    create: (opts) => {
      const adapter = git.provider.create(opts);
      return {
        ...adapter,
        setState: async (input) => {
          if (failure.message !== null) {
            throw new Error(failure.message);
          }
          await adapter.setState(input);
        },
      };
    },
  };
}

function depsOf(parts: {
  db: DatabaseAdapter;
  storage: StorageAdapter;
  provider: StateNotifierProvider;
}): BuildStateDeps {
  return {
    db: parts.db,
    storage: parts.storage,
    notifiers: [parts.provider],
    secret: SECRET,
    config: { publicBaseUrl: "https://shelf.example.com" },
    flags: () => ({ testing: true, review: false }),
    logger: createShelfLogger({ level: "silent" }),
  };
}

/** The `(context, state)` of every status write, in order. */
export function statusLog(git: FakeStateNotifier): [string, string][] {
  return git.calls.flatMap((call) =>
    call.target.kind === "status" ? [[call.target.context, call.state] as [string, string]] : [],
  );
}
