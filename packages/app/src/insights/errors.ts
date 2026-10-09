/** JSON errors for the insights API (`{ message }`, optional `Retry-After`). */
import { HTTPException } from "hono/http-exception";

/** Throw an HTTP error with a JSON `{ message }` body. */
export function failWith(
  status: 400 | 409 | 429 | 501,
  message: string,
  retryAfterSeconds?: number,
): never {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (retryAfterSeconds !== undefined) {
    headers["retry-after"] = String(retryAfterSeconds);
  }
  throw new HTTPException(status, {
    message,
    res: new Response(JSON.stringify({ message }), { status, headers }),
  });
}
