/**
 * The reason of each adapter that failed to start, one line each, after the "Adapter setup failed"
 * line that only names them (the text is already redacted by the setup runner).
 */
export function failureLines(error: unknown): string[] {
  const failures = (error as { failures?: unknown } | null)?.failures;
  if (!Array.isArray(failures)) return [];
  return failures.flatMap((failure: { category?: string; kind?: string; error?: string }) =>
    failure.error ? [`  ${failure.category}/${failure.kind}: ${failure.error}`] : [],
  );
}
