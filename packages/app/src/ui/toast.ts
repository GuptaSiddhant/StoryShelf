/** Visual tone of a toast. */
export type ToastTone = "success" | "danger" | "warning" | "info";

/** Escape non-ASCII so the JSON survives as an HTTP header value. */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replaceAll(
    /[\u0080-￿]/gu,
    (char) => `\\u${char.codePointAt(0)?.toString(16).padStart(4, "0") ?? "0000"}`,
  );
}

/**
 * Response headers that show a toast once HTMX has swapped the new content in.
 * `After-Swap` matters: review actions swap `body`, which would destroy a toast
 * rendered any earlier.
 */
export function toastHeaders(message: string, tone: ToastTone = "success"): Record<string, string> {
  return { "HX-Trigger-After-Swap": asciiJson({ showToast: { message, tone } }) };
}
