/**
 * Boot-time adapter validation: fail fast on third-party adapters that
 * cannot satisfy their slot contract.
 *
 * Types alone cannot stop a bad adapter — this module checks shape at
 * runtime before any I/O runs. `createShelfApp` throws synchronously;
 * the lifecycle runner returns failures without executing hooks.
 */
import { z } from "zod";
import { REQUIRED_TABLE_KEYS } from "./database.ts";
import type { AdapterSetupFailure, AdapterSetupSources } from "./setup.ts";

const metadataSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  kind: z.string().min(1),
  category: z.string().min(1),
});

const DATABASE_METHODS = ["insert", "update", "get", "remove", "list", "count", "all"];

const STORAGE_METHODS = ["read", "write", "delete", "exists", "list", "writeStream", "readStream"];

const RUNNER_METHODS = ["render", "cancel"];

const QUEUE_METHODS = ["enqueue", "status", "active", "recent"];

/** Unknown value narrowed to a property bag for shape checks. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** String field of a record, or null when absent/non-string. */
function stringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

/** Reasons the adapter identity fails for the expected slot. */
function metadataReasons(adapter: Record<string, unknown>, expected: string): string[] {
  const parsed = metadataSchema.safeParse(adapter["metadata"]);
  if (!parsed.success) {
    return [`invalid metadata: ${parsed.error.issues.map((i) => i.path.join(".")).join(",")}`];
  }
  const category = (parsed.data as { category: string }).category;
  return category === expected ? [] : [`category "${category}" does not match slot "${expected}"`];
}

/** Reasons the optional lifecycle violates the all-or-nothing rule. */
function lifecycleReasons(adapter: Record<string, unknown>): string[] {
  const lifecycle = adapter["lifecycle"];
  if (lifecycle === undefined) {
    return [];
  }
  const hooks = asRecord(lifecycle);
  if (!hooks) {
    return ["lifecycle must be an object with setup/teardown/health"];
  }
  const missing = ["setup", "teardown", "health"].filter(
    (hook) => typeof hooks[hook] !== "function",
  );
  return missing.length > 0 ? [`partial lifecycle (missing: ${missing.join(",")})`] : [];
}

/** Reasons the adapter lacks required slot methods. */
function methodReasons(adapter: Record<string, unknown>, methods: string[]): string[] {
  const missing = methods.filter((method) => typeof adapter[method] !== "function");
  return missing.length > 0 ? [`missing methods: ${missing.join(",")}`] : [];
}

/** Reasons a database adapter lacks its table map. */
function tableReasons(adapter: Record<string, unknown>): string[] {
  const tables = asRecord(adapter["tables"]);
  if (!tables) {
    return ["missing tables map"];
  }
  const missing = REQUIRED_TABLE_KEYS.filter((table) => tables[table] === undefined);
  return missing.length > 0 ? [`missing tables: ${missing.join(",")}`] : [];
}

/** Reasons a queue adapter has a partial poll extension. */
function queuePollReasons(record: Record<string, unknown>): string[] {
  const present = ["poll", "ack", "nack"].filter((method) => record[method] !== undefined);
  if (present.length === 0 || present.length === 3) {
    const mistyped = ["poll", "ack", "nack"].filter(
      (method) => record[method] !== undefined && typeof record[method] !== "function",
    );
    return mistyped.map((method) => `queue poll extension "${method}" must be a function`);
  }
  return [`partial poll extension (present: ${present.join(",")}; need poll+ack+nack)`];
}

/** Whether a metadata schema looks like a zod schema (has parse). */
function hasSchemaParse(provider: unknown): boolean {
  const schema = asRecord(asRecord(provider)?.["metadata"])?.["schema"];
  return typeof (schema as { parse?: unknown } | undefined)?.parse === "function";
}

/** Reasons a notifier provider lacks its descriptor shape. */
function notifierReasons(provider: unknown): string[] {
  const record = asRecord(provider);
  if (!record) {
    return ["notifier provider must be an object"];
  }
  const reasons = metadataReasons(record, "notifier");
  if (typeof record["create"] !== "function") {
    reasons.push("missing methods: create");
  }
  if (!hasSchemaParse(provider)) {
    reasons.push("metadata.schema must be a zod schema");
  }
  return reasons;
}

/** Reasons an email sender lacks its transport shape. */
function emailSenderReasons(sender: unknown): string[] {
  const record = asRecord(sender);
  if (!record) {
    return ["email sender must be an object"];
  }
  const reasons = metadataReasons(record, "notifier");
  if (typeof record["send"] !== "function") {
    reasons.push("missing methods: send");
  }
  return reasons;
}

/** Reasons a git provider lacks its descriptor shape. */
function gitReasons(provider: unknown): string[] {
  const record = asRecord(provider);
  if (!record) {
    return ["git provider must be an object"];
  }
  const reasons = metadataReasons(record, "git-host");
  if (typeof record["create"] !== "function") {
    reasons.push("missing methods: create");
  }
  if (!hasSchemaParse(provider)) {
    reasons.push("metadata.schema must be a zod schema");
  }
  return reasons;
}

/** Required methods for a slot category. */
function slotMethods(category: string): string[] {
  if (category === "database") {
    return DATABASE_METHODS;
  }
  if (category === "storage") {
    return STORAGE_METHODS;
  }
  if (category === "capture-runner") {
    return RUNNER_METHODS;
  }
  return QUEUE_METHODS;
}

/** Extra per-slot reasons (table map for databases, poll rule for queues). */
function slotExtraReasons(record: Record<string, unknown>, category: string): string[] {
  if (category === "database") {
    return tableReasons(record);
  }
  return category === "capture-queue" ? queuePollReasons(record) : [];
}

/**
 * Validate one adapter against its slot. Returns human-readable reasons
 * (empty when valid). Never throws — callers decide fail-fast vs collect.
 */
export function validateAdapter(
  adapter: unknown,
  expectedCategory: string,
  slot: string,
): string[] {
  const record = asRecord(adapter);
  if (!record) {
    return [`${slot} adapter must be an object`];
  }
  const reasons = metadataReasons(record, expectedCategory).map((r) => `${slot}: ${r}`);
  const extra = [
    ...lifecycleReasons(record),
    ...methodReasons(record, slotMethods(expectedCategory)),
    ...slotExtraReasons(record, expectedCategory),
  ];
  for (const reason of extra) {
    reasons.push(`${slot}: ${reason}`);
  }
  return reasons;
}

/** One slot check for source validation. */
interface SlotCheck {
  adapter: unknown;
  category: string;
  slot: string;
}

/** Descriptor check for provider lists (git hosts, notifiers). */
interface ProviderCheck {
  provider: unknown;
  index: number;
  kinds: "git" | "notifier";
}

/** Failures for git-host or notifier provider lists. */
function checkProviders(checks: ProviderCheck[]): AdapterSetupFailure[] {
  const failures: AdapterSetupFailure[] = [];
  for (const check of checks) {
    const reasons =
      check.kinds === "git" ? gitReasons(check.provider) : notifierReasons(check.provider);
    if (reasons.length === 0) {
      continue;
    }
    const slot = check.kinds === "git" ? `gitHosts[${check.index}]` : `notifiers[${check.index}]`;
    const category = check.kinds === "git" ? "git-host" : "notifier";
    const metadata = asRecord(asRecord(check.provider)?.["metadata"]);
    failures.push({
      category,
      kind: stringField(metadata, "kind") ?? "unknown",
      name: stringField(metadata, "name") ?? slot,
      error: reasons.map((reason) => `${slot}: ${reason}`).join("; "),
    });
  }
  return failures;
}

/** Failure for the email sender slot. */
function checkEmailSender(sender: unknown): AdapterSetupFailure[] {
  if (sender === undefined) {
    return [];
  }
  const reasons = emailSenderReasons(sender);
  if (reasons.length === 0) {
    return [];
  }
  const metadata = asRecord(asRecord(sender)?.["metadata"]);
  return [
    {
      category: "notifier",
      kind: stringField(metadata, "kind") ?? "unknown",
      name: stringField(metadata, "name") ?? "emailSender",
      error: reasons.map((reason) => `emailSender: ${reason}`).join("; "),
    },
  ];
}

/** Failures for the core database/storage/runner/queue slots. */
function checkSlots(checks: SlotCheck[]): AdapterSetupFailure[] {
  const failures: AdapterSetupFailure[] = [];
  for (const check of checks) {
    const reasons = validateAdapter(check.adapter, check.category, check.slot);
    if (reasons.length === 0) {
      continue;
    }
    const metadata = asRecord(asRecord(check.adapter)?.["metadata"]);
    failures.push({
      category: check.category,
      kind: stringField(metadata, "kind") ?? "unknown",
      name: stringField(metadata, "name") ?? check.slot,
      error: reasons.join("; "),
    });
  }
  return failures;
}

/**
 * Validate every adapter in the boot sources. Returns per-adapter failures
 * (empty when the whole assembly is sound).
 */
export function validateAdapterSources(sources: AdapterSetupSources): AdapterSetupFailure[] {
  const checks: SlotCheck[] = [
    { adapter: sources.database, category: "database", slot: "database" },
    { adapter: sources.storage, category: "storage", slot: "storage" },
  ];
  if (sources.captureRunner !== undefined) {
    checks.push({
      adapter: sources.captureRunner,
      category: "capture-runner",
      slot: "captureRunner",
    });
  }
  if (sources.captureQueue !== undefined) {
    checks.push({ adapter: sources.captureQueue, category: "capture-queue", slot: "captureQueue" });
  }
  const providers: ProviderCheck[] = [
    ...(sources.gitHosts ?? []).map((provider, index) => ({
      provider,
      index,
      kinds: "git" as const,
    })),
    ...(sources.notifiers ?? []).map((provider, index) => ({
      provider,
      index,
      kinds: "notifier" as const,
    })),
  ];
  return [
    ...checkSlots(checks),
    ...checkProviders(providers),
    ...checkEmailSender(sources.emailSender),
  ];
}
