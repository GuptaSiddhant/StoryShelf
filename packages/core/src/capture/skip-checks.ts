import type { DatabaseAdapter } from "../adapters/database.ts";
import type { GitHostProvider } from "../adapters/git-host/index.ts";
import type { Logger } from "../logger.ts";
import { BuildModel } from "../models/build.ts";
import { StatusConfigModel } from "../models/status-config.ts";
import type { ProjectStatusConfig } from "../schema/status-config.ts";

/** Skip capture when another approved build already covers the same commit. */
export async function hasApprovedBuildForSha(
  db: DatabaseAdapter,
  projectId: string,
  sha: string,
  excludeBuildId: string,
): Promise<boolean> {
  const builds = await new BuildModel(db).list(projectId);
  return builds.some((b) => b.gitSha === sha && b.id !== excludeBuildId && b.status === "approved");
}

/** Inputs for checking whether a commit is already merged upstream. */
export interface MergeCheck {
  providers: GitHostProvider[];
  sha: string;
  branch: string;
  secret: string | undefined;
  db: DatabaseAdapter;
  projectId: string;
  logger?: Logger;
}

interface ParsedRow {
  provider: GitHostProvider;
  config: unknown;
  token: string;
}

function findRowProvider(
  providers: GitHostProvider[],
  row: { provider: string },
): GitHostProvider | undefined {
  return providers.find((p) => p.metadata.kind === row.provider);
}

function decodeRowConfig(provider: GitHostProvider, configJson: string): unknown {
  try {
    const parsed: unknown = JSON.parse(configJson);
    provider.metadata.schema.parse(parsed);
    return parsed;
  } catch {
    return null;
  }
}

function decodeRowToken(model: StatusConfigModel, row: ProjectStatusConfig): string | null {
  try {
    return model.decryptToken(row);
  } catch {
    return null;
  }
}

function parseRow(
  model: StatusConfigModel,
  row: ProjectStatusConfig,
  providers: GitHostProvider[],
): ParsedRow | null {
  const provider = findRowProvider(providers, row);
  if (!provider) {
    return null;
  }
  const parsed = decodeRowConfig(provider, row.config);
  if (parsed === null) {
    return null;
  }
  const token = decodeRowToken(model, row);
  if (token === null) {
    return null;
  }
  return { provider, config: parsed, token };
}

async function checkRowMerged(
  parsed: ParsedRow,
  sha: string,
  branch: string,
  logger?: Logger,
): Promise<boolean> {
  const adapter = parsed.provider.create({ config: parsed.config, token: parsed.token, logger });
  if (!adapter.isMerged) {
    return false;
  }
  try {
    return await adapter.isMerged({ sha, branch });
  } catch {
    // Ignore provider errors — do not skip on failure
    return false;
  }
}

/** Check one status-config row for an upstream merge. */
async function checkRow(
  model: StatusConfigModel,
  row: ProjectStatusConfig,
  providers: GitHostProvider[],
  sha: string,
  branch: string,
  logger?: Logger,
): Promise<boolean> {
  const parsed = parseRow(model, row, providers);
  if (!parsed) {
    return false;
  }
  return await checkRowMerged(parsed, sha, branch, logger);
}

/** True when any configured provider reports the commit already merged. */
export async function isAlreadyMerged(opts: MergeCheck): Promise<boolean> {
  if (opts.providers.length === 0) {
    return false;
  }
  const model = new StatusConfigModel(opts.db, opts.secret);
  const rows = await model.list(opts.projectId);
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop -- short-circuit on first merged status
    if (await checkRow(model, row, opts.providers, opts.sha, opts.branch, opts.logger)) {
      return true;
    }
  }
  return false;
}
