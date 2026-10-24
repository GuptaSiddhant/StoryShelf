/**
 * MySQL DATETIME(3) column that keeps StoryShelf's ISO-8601 timestamps.
 *
 * MySQL does not accept `2026-10-24T10:34:17.691Z`; the adapter stores UTC
 * values as `2026-10-24 10:34:17.691` and converts them back on read. Keeping
 * the conversion on the column means inserts, updates and every comparison
 * (queue leases, retention cut-offs) use the same form.
 */
import { customType } from "drizzle-orm/mysql-core";

interface DateTimeConfig {
  mode?: "string";
  fsp?: number;
}

export const datetime = customType<{
  data: string;
  driverData: string;
  config: DateTimeConfig;
}>({
  dataType(config) {
    return `datetime(${config?.fsp ?? 3})`;
  },
  toDriver(value: string): string {
    return toMySqlDateTime(value);
  },
  fromDriver(value: string): string {
    return fromMySqlDateTime(value);
  },
});

export function toMySqlDateTime(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) {
    return iso;
  }
  return new Date(time).toISOString().slice(0, 23).replace("T", " ");
}

export function fromMySqlDateTime(value: string): string {
  const raw: unknown = value;
  if (raw instanceof Date) {
    return raw.toISOString();
  }
  if (value.includes("T")) {
    return value;
  }
  const [date, time] = value.split(" ");
  if (!date || !time) {
    return value;
  }
  const parsed = new Date(`${date}T${time}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}
