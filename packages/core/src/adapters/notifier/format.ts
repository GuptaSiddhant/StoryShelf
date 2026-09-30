import type {
  ChannelToggles,
  FormattedNotification,
  NotificationBrand,
  NotificationEvent,
  SystemNotification,
} from "./types.ts";

/** Escape HTML special chars in free-form values (commit messages, names). */
function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Read a string field from event data without throwing on shapes. */
function str(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

/** Resolve toggle defaults (Brand + toggles v1: no custom templates). */
function togglesOf(toggles?: ChannelToggles): Required<ChannelToggles> {
  return {
    style: toggles?.style ?? "compact",
    subjectPrefix: toggles?.subjectPrefix ?? "[Shelf]",
    includeAuthor: toggles?.includeAuthor ?? true,
    includeMessage: toggles?.includeMessage ?? true,
    includeCounts: toggles?.includeCounts ?? true,
  };
}

/** One-line summary for an event (used in subject + compact bodies). */
function headline(event: NotificationEvent): string {
  const branch = str(event.data, "gitBranch") || str(event.data, "branch");
  const status = str(event.data, "status");
  const story = str(event.data, "storyId");
  if (story) {
    return `${event.event} ${story}${branch ? ` on ${branch}` : ""}`;
  }
  return `${event.event}${branch ? ` on ${branch}` : ""}${status ? ` (${status})` : ""}`;
}

/** Append author/message/counts lines for verbose bodies. */
function appendDetails(
  lines: string[],
  event: NotificationEvent,
  resolved: Required<ChannelToggles>,
): void {
  if (resolved.style !== "verbose") {
    return;
  }
  const author = str(event.data, "authorName") || str(event.data, "authorEmail");
  if (resolved.includeAuthor && author) {
    lines.push(`by ${author}`);
  }
  const message = str(event.data, "message");
  if (resolved.includeMessage && message) {
    lines.push(message);
  }
  appendCounts(lines, event, resolved);
}

/** Append numeric count summary (snapshot/changed/approved/rejected). */
function appendCounts(
  lines: string[],
  event: NotificationEvent,
  resolved: Required<ChannelToggles>,
): void {
  if (!resolved.includeCounts) {
    return;
  }
  const counts = ["snapshotCount", "changedCount", "approvedCount", "rejectedCount"]
    .map((key) => {
      const value = event.data[key];
      return typeof value === "number" ? `${key}=${value}` : "";
    })
    .filter((part) => part !== "")
    .join(" ");
  if (counts) {
    lines.push(counts);
  }
}

/** Render text/html envelopes around body lines plus brand footer. */
function envelope(
  subject: string,
  lines: string[],
  brand?: NotificationBrand,
): FormattedNotification {
  const name = brand?.name ?? "StoryShelf";
  const text = lines.join("\n");
  const footer = brand?.footerText ?? `Sent by ${name}`;
  const htmlBody = lines.map((line) => esc(line)).join("<br/>");
  const logo = brand?.logo ? `<img src="${esc(brand.logo)}" alt="" width="24"/>` : "";
  return {
    subject,
    text: `${text}\n\n${footer}`,
    markdown: `${text}\n\n_${esc(footer)}_`,
    html: `${logo}<p>${htmlBody}</p><p><small>${esc(footer)}</small></p>`,
  };
}

/**
 * Format a project event into subject/text/markdown/html using brand +
 * channel toggles. Pure (no I/O) so settings preview and senders share it.
 */
export function formatNotification(
  event: NotificationEvent,
  brand?: NotificationBrand,
  toggles?: ChannelToggles,
): FormattedNotification {
  const resolved = togglesOf(toggles);
  const name = brand?.name ?? "StoryShelf";
  const subject = `${resolved.subjectPrefix} ${headline(event)}`.trim();
  const lines = [`${name}: ${headline(event)}`];
  appendDetails(lines, event, resolved);
  if (brand?.reviewUrl) {
    lines.push(brand.reviewUrl);
  }
  return envelope(subject, lines, brand);
}

/** Format a site-wide admin alert (no project scope, always verbose). */
export function formatSystemNotification(
  event: SystemNotification,
  brand?: NotificationBrand,
): FormattedNotification {
  return formatNotification(
    { event: event.event, data: event.data, timestamp: event.timestamp },
    brand,
    { style: "verbose", subjectPrefix: "[Shelf sys]" },
  );
}
