/** Not-found guard for GCS API errors. */

/** Return whether a GCS error signals a missing object. */
export function isNotFound(error: unknown): boolean {
  const err = error as {
    code?: number | string;
    statusCode?: number;
    errors?: { reason?: string }[];
  };
  if (err.code === 404 || err.code === "404" || err.code === "notFound") {
    return true;
  }
  if (err.statusCode === 404) {
    return true;
  }
  return err.errors?.[0]?.reason === "notFound";
}
