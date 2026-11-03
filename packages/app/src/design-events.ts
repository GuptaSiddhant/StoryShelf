/**
 * `design:changed`: a design moved after its baseline was approved, or no longer exists. It rides
 * the existing paths (signed webhooks and the notification fan-out) and is a normal subscribable
 * topic: it is not default-on (see `notify.ts`), so only people who opted in hear about it.
 *
 * Sent once per (project, design node, design version) from the first health check that sees the
 * change. The durable claim is `DesignNodeModel.claimChange`; with no confirmed public origin
 * nothing is sent and nothing is claimed, so the change is still announced once an origin exists.
 * There is no boot replay: an unannounced change waits for the next health check.
 */
import { emitWebhookEvent } from "@storyshelf/core/adapter/webhook-events";
import { designChange, type DesignChange, type DesignNodeModel } from "@storyshelf/core/models";
import type { DesignNode, Project } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import { credentialKeys } from "./credential-keys.ts";
import { clearPaused, notificationOrigin, warnPaused } from "./notifications-pause.ts";
import { notifyProjectWith, type NotifyDeps } from "./notify.ts";

/** Event name of a design change. */
export const DESIGN_CHANGED_EVENT = "design:changed";

/** What `design:changed` carries. */
export interface DesignChangedData extends Record<string, unknown> {
  projectId: string;
  /** Story file (the component) whose design changed. */
  componentPath: string;
  figmaUrl: string;
  change: DesignChange["change"];
  designVersion: string | null;
}

/** One design a health check looked at. */
export interface DesignObservation {
  url: string;
  node: DesignNode | undefined;
  /** The component (story file) the design belongs to. */
  componentPath: string | null;
  /** Version of the baseline the component was approved at. */
  baselineVersion: string | null;
}

/**
 * Announce every observed design change not announced before. Never throws: a failure is logged
 * and the next health check tries again.
 */
export async function announceDesignChangesWith(
  deps: NotifyDeps,
  nodes: Pick<DesignNodeModel, "claimChange">,
  project: Pick<Project, "id" | "slug">,
  observations: readonly DesignObservation[],
): Promise<void> {
  const changes = observations.flatMap((observation) => {
    const change = observation.componentPath
      ? designChange(observation.node, observation.baselineVersion)
      : null;
    return observation.node && observation.componentPath && change
      ? [
          {
            ...observation,
            node: observation.node,
            componentPath: observation.componentPath,
            change,
          },
        ]
      : [];
  });
  if (changes.length === 0 || !(await originConfirmed(deps))) return;
  await Promise.all(
    changes.map(async (item) => {
      try {
        if (await nodes.claimChange(item.node, item.change)) await announce(deps, project, item);
      } catch (error) {
        deps.logger.warn({ err: error, projectId: project.id }, "design change not announced");
      }
    }),
  );
}

async function originConfirmed(deps: NotifyDeps): Promise<boolean> {
  const origin = await notificationOrigin(deps);
  if (origin === undefined) {
    warnPaused(deps.logger, DESIGN_CHANGED_EVENT);
    return false;
  }
  clearPaused(deps.logger);
  return true;
}

async function announce(
  deps: NotifyDeps,
  project: Pick<Project, "id" | "slug">,
  item: { url: string; componentPath: string; change: DesignChange },
): Promise<void> {
  const data: DesignChangedData = {
    projectId: project.id,
    componentPath: item.componentPath,
    figmaUrl: item.url,
    change: item.change.change,
    designVersion: item.change.designVersion,
  };
  await emitWebhookEvent(
    deps.db,
    { webhooks: deps.db.tables.webhooks },
    project.id,
    DESIGN_CHANGED_EVENT,
    data,
    credentialKeys(deps.config),
    deps.logger,
  );
  const component = createUrlBuilder("").component(project.slug, item.componentPath);
  await notifyProjectWith(
    deps,
    project,
    DESIGN_CHANGED_EVENT,
    data,
    component.slice(`/projects/${project.slug}`.length),
  );
}
