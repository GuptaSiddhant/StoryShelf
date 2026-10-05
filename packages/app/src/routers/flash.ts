import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { isHxRequest } from "./htmx.ts";

/** Visual tone of a flash message. */
export type FlashTone = "success" | "danger" | "warning" | "info";

/** Cookie the client script reads, shows as a toast, and clears. */
export const FLASH_COOKIE = "storyshelf_flash";

const MAX_MESSAGE_LENGTH = 140;

/**
 * Queue a one-shot toast for the next page the browser renders. The server
 * decides this (only after the action actually succeeded), so it works for
 * HTMX redirects, in-place swaps, and plain form posts alike. The cookie is
 * short-lived and readable by the page script, which shows it with
 * `textContent` and removes it.
 */
export function flash(c: Context, message: string, tone: FlashTone = "success"): void {
  const text =
    message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : message;
  setCookie(c, FLASH_COOKIE, JSON.stringify({ message: text, tone }), {
    path: "/",
    maxAge: 60,
    sameSite: "Lax",
  });
}

/** Like {@link flash}, but only for HTMX callers (keeps JSON API responses cookie-free). */
export function flashHx(c: Context, message: string, tone: FlashTone = "success"): void {
  if (isHxRequest(c)) {
    flash(c, message, tone);
  }
}
