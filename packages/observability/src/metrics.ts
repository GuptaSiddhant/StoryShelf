/**
 * Memoized OTEL instruments (global meter, `storyshelf` scope).
 *
 * Instruments are created once — duplicate `createHistogram` calls on one
 * meter log warnings, hence the module cache. Without an SDK these are
 * noops. Attribute values stay low-cardinality (operations, statuses);
 * IDs and paths never appear here.
 */
import { metrics, type Counter, type Histogram } from "@opentelemetry/api";

/** Meter scope for StoryShelf instruments. */
const METER_NAME = "storyshelf";

/** Capture-pipeline instruments. */
export interface CaptureInstruments {
  /** Capture job wall duration in milliseconds (`capture.job.status`). */
  jobDuration: Histogram;
  /** Completed jobs (`capture.job.status = completed`). */
  jobsCompleted: Counter;
  /** Failed jobs (`capture.job.status = failed`). */
  jobsFailed: Counter;
}

/** Database-operation instruments. */
export interface DbInstruments {
  /** Per-operation wall duration in milliseconds (`db.operation`, `db.table`). */
  operationDuration: Histogram;
}

/** Storage-operation instruments. */
export interface StorageInstruments {
  /** Per-operation wall duration in milliseconds (`storage.operation`). */
  operationDuration: Histogram;
}

let capture: CaptureInstruments | undefined;
let database: DbInstruments | undefined;
let storage: StorageInstruments | undefined;

/** Capture-pipeline instruments (created once). */
export function captureMetrics(): CaptureInstruments {
  if (!capture) {
    const meter = metrics.getMeter(METER_NAME);
    capture = {
      jobDuration: meter.createHistogram("capture.job.duration", { unit: "ms" }),
      jobsCompleted: meter.createCounter("capture.jobs.completed"),
      jobsFailed: meter.createCounter("capture.jobs.failed"),
    };
  }
  return capture;
}

/** Database-operation instruments (created once). */
export function dbMetrics(): DbInstruments {
  if (!database) {
    const meter = metrics.getMeter(METER_NAME);
    database = {
      operationDuration: meter.createHistogram("db.operation.duration", { unit: "ms" }),
    };
  }
  return database;
}

/** Storage-operation instruments (created once). */
export function storageMetrics(): StorageInstruments {
  if (!storage) {
    const meter = metrics.getMeter(METER_NAME);
    storage = {
      operationDuration: meter.createHistogram("storage.operation.duration", { unit: "ms" }),
    };
  }
  return storage;
}
