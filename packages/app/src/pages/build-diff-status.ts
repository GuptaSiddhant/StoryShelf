import type { Build } from "@storyshelf/core/schema";
import type { IconName } from "../ui/components.tsx";
import type { BuildDetailsData } from "./build-detail.tsx";

/** How the build page names a build's status: sentence-case label, tone and icon. */
export interface StatusView {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
  icon: IconName;
}

const VIEWS: Record<Build["status"], StatusView> = {
  pending: { label: "Queued", tone: "info", icon: "clock" },
  capturing: { label: "Capturing", tone: "info", icon: "loader" },
  comparing: { label: "Comparing", tone: "info", icon: "loader" },
  reviewing: { label: "Needs review", tone: "warning", icon: "alert-triangle" },
  approved: { label: "Approved", tone: "success", icon: "check" },
  rejected: { label: "Rejected", tone: "danger", icon: "x-circle" },
  failed: { label: "Capture failed", tone: "danger", icon: "x-circle" },
  cancelled: { label: "Cancelled", tone: "neutral", icon: "x-circle" },
};

/** The status strip's heading, tone and icon for a build ("Published" for an upload without capture). */
export function statusView(build: Build, details?: BuildDetailsData): StatusView {
  return details?.published
    ? { label: "Published", tone: "success", icon: "check" }
    : VIEWS[build.status];
}

/** Whether capture has not finished: the stage shows progress, never a verdict. */
export function isCapturing(build: Build): boolean {
  return build.status === "pending" || build.status === "capturing" || build.status === "comparing";
}

/** Whether a retry makes sense: the build ended without snapshots to review. */
export function isRetryable(build: Build): boolean {
  return build.status === "failed" || build.status === "cancelled";
}

function firstLine(text: string | null | undefined): string | null {
  const line = text
    ?.split("\n")
    .map((part) => part.trim())
    .find((part) => part !== "");
  return line ?? null;
}

/**
 * Why the last capture attempt ended badly: the first line of its error, else its last error log
 * line; null when nothing was recorded. Read from the stored attempts, never a new table.
 */
export function failureReason(details?: BuildDetailsData): string | null {
  const last = details?.attempts.at(-1);
  if (!last) {
    return null;
  }
  const logged = last.logs.findLast((line) => line.level === "error");
  return firstLine(last.attempt.error) ?? firstLine(logged?.message);
}
