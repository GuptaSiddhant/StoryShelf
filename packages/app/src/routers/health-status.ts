/**
 * Status rows for the admin health report: facts an operator depends on that need no probe
 * (telemetry export, image engine, public origin, Storybook hosting). They never change the report
 * status, never call out, and carry no URL beyond an origin, no header and no secret. Admin-only:
 * the public `GET /api/v1/health` never includes them.
 */
import { hostingModeOf, type ShelfConfig, storybookHostingOf } from "@storyshelf/core/config";
import { imageEngineState } from "@storyshelf/core/diff";
import type { PublicOriginResolver } from "@storyshelf/core/models";
import { redactUrlForLog } from "@storyshelf/core/utils";

/** How a status row reads: `ok` is as expected, `warn` needs a look, `off` is a feature turned off. */
export type StatusTone = "ok" | "warn" | "off";

/** One informational row. */
export interface StatusRow {
  id: "telemetry" | "image-engine" | "public-origin" | "hosting";
  label: string;
  value: string;
  tone: StatusTone;
  detail?: string;
}

/** What {@link collectStatusRows} reads. */
export interface StatusInputs {
  env: Readonly<Record<string, string | undefined>>;
  config: ShelfConfig;
  publicOrigin?: PublicOriginResolver | undefined;
}

/** Same rule as `@storyshelf/observability`: on with an endpoint, or `STORYSHELF_OTEL_ENABLED=true`. */
export function telemetryRow(env: StatusInputs["env"]): StatusRow {
  const endpoint = env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  const explicit = env["STORYSHELF_OTEL_ENABLED"];
  const enabled =
    env["OTEL_SDK_DISABLED"] !== "true" && (explicit ? explicit === "true" : Boolean(endpoint));
  const base = { id: "telemetry", label: "Telemetry export" } as const;
  if (!enabled) {
    return { ...base, value: "off", tone: "off" };
  }
  // The origin only: the path and any userinfo or query of an endpoint can carry credentials.
  return {
    ...base,
    value: "on",
    tone: "ok",
    detail: endpoint ? `exporting to ${redactUrlForLog(endpoint)}` : "exporter host not set",
  };
}

/** The diff engine and its worker pool; in-thread diffs are noted, never a failure. */
export function imageEngineRow(): StatusRow {
  const state = imageEngineState();
  const where = state.inThread
    ? "diffs run on the main thread"
    : `${state.workers} diff worker${state.workers === 1 ? "" : "s"}`;
  return {
    id: "image-engine",
    label: "Image engine",
    value: state.engine,
    tone: "ok",
    detail: where,
  };
}

/** Confirmed or not, and why: with none confirmed no notification or link is sent. */
export async function publicOriginRow(resolver?: PublicOriginResolver): Promise<StatusRow> {
  const base = { id: "public-origin", label: "Public origin" } as const;
  if (resolver === undefined) {
    return { ...base, value: "not tracked", tone: "off" };
  }
  const resolved = await resolver.resolve();
  if (resolved !== null) {
    return {
      ...base,
      value: "confirmed",
      tone: "ok",
      detail: `${resolved.url} (${resolved.source})`,
    };
  }
  const stored = await resolver.stored();
  const why = stored
    ? "a browser reported an origin but no admin confirmed it"
    : "none configured, none reported";
  return {
    ...base,
    value: "not confirmed",
    tone: "warn",
    detail: `${why}; notifications and links are not sent`,
  };
}

/** Storybook hosting mode (ADR 0051) and, in `subdomain` mode, the content host suffix. */
export function hostingRow(config: ShelfConfig): StatusRow {
  const mode = hostingModeOf(config);
  const baseDomain = storybookHostingOf(config)?.baseDomain;
  return {
    id: "hosting",
    label: "Storybook hosting",
    value: mode,
    tone: "ok",
    ...(mode === "subdomain" && baseDomain !== undefined
      ? { detail: `content host *.${baseDomain}` }
      : {}),
  };
}

/** Every status row, in display order. */
export async function collectStatusRows(inputs: StatusInputs): Promise<StatusRow[]> {
  return [
    telemetryRow(inputs.env),
    imageEngineRow(),
    await publicOriginRow(inputs.publicOrigin),
    hostingRow(inputs.config),
  ];
}
