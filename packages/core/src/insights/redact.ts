/** Secret redaction applied to every string before it can reach a model. */

const MARK = "[REDACTED]";

const SENSITIVE_KEY = "secret|token|password|passwd|api[_-]?key|authorization|cookie|credential";

const RULES: readonly [RegExp, string][] = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gu, `$1 ${MARK}`],
  // key=value / key: value / "key": "value" for sensitive key names
  [
    new RegExp(`((?:${SENSITIVE_KEY})[\\w-]*["']?\\s*[:=]\\s*["']?)[^\\s"',;&]+`, "giu"),
    `$1${MARK}`,
  ],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/giu, `//${MARK}@`],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/gu, MARK],
  [/\b(?:sk-|ghp_|gho_|ghs_|github_pat_|xox[abprs]-|AKIA|ASIA)[A-Za-z0-9_-]{8,}/gu, MARK],
  [/\b(?=[A-Za-z0-9+]*\d)[A-Za-z0-9+]{32,}={0,2}(?![A-Za-z0-9+])/gu, MARK],
];

/** Replace secrets in a string with a fixed marker (never throws). */
export function redactText(input: string): string {
  let out = input;
  for (const [pattern, replacement] of RULES) {
    out = out.replaceAll(pattern, replacement);
  }
  return out;
}
