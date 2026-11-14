import type { FormattedNotification } from "../../adapters/notifier/index.ts";
import type { PushPayload } from "./types.ts";

const MAX_TITLE = 100;
const MAX_BODY = 200;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * The path and query of `link` when it is an http(s) URL. The sender already built it under the
 * confirmed public origin (`notificationOrigin`), so the worker gets a path to resolve against its
 * own origin, never an absolute URL it could be steered with.
 */
export function relativePath(link?: string): string | undefined {
  if (link === undefined) {
    return undefined;
  }
  try {
    const url = new URL(link);
    return url.protocol === "https:" || url.protocol === "http:"
      ? `${url.pathname}${url.search}`
      : undefined;
  } catch {
    return undefined;
  }
}

/** What a device shows: a title, a one-line body and, when the message has a link, its path. */
export function payloadOf(formatted: FormattedNotification): PushPayload {
  const line = formatted.summary ?? formatted.text.split("\n")[0] ?? "";
  const url = relativePath(formatted.url);
  return {
    title: clip(formatted.subject, MAX_TITLE),
    body: clip(line, MAX_BODY),
    ...(url === undefined ? {} : { url }),
  };
}
