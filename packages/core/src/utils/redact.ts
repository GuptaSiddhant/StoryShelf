/**
 * Secret redaction for adapter errors, health details, and logs.
 *
 * Adapter-thrown messages routinely embed connection strings and tokens.
 * Every surface that exposes adapter text (503 gate, health report, error
 * logs) must pass through here before truncation or transport.
 */

const SECRET_PATTERNS: RegExp[] = [
  /(:\/\/)[^/\s:]+:[^/\s@]+(?=@)/u,
  /([?&#](?:token|secret|password|api[_-]?key|auth[_-]?token|access[_-]?key)=)[^&#\s]*/giu,
  /((?:password|passwd|secret|token|api[_-]?key|auth[_-]?token|client[_-]?secret|access[_-]?key|private[_-]?key)\s*[:=]\s*['"]?)[^\s'";,[\]&]+/giu,
  /AKIA[0-9A-Z]{16}/gu,
  /gh[pous]_[A-Za-z0-9_]+/gu,
  /github_pat_[A-Za-z0-9_]+/gu,
  /xox[bpasr]-[A-Za-z0-9-]+/gu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
];

/** Replace embedded secrets with `[redacted]`. Never throws on weird input. */
export function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, (...args: unknown[]) => {
      const group = args[1];
      return typeof group === "string" ? `${group}[redacted]` : "[redacted]";
    });
  }
  return redacted;
}

/** Redact secrets, then truncate to `maxLength`. */
export function sanitizeErrorText(text: string, maxLength: number): string {
  const redacted = redactSecrets(text);
  return redacted.length > maxLength ? redacted.slice(0, maxLength) : redacted;
}
