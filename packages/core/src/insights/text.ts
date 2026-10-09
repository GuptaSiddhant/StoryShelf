/** Text helpers for deterministic, safe evidence. */
import { redactText } from "./redact.ts";

const LT = "‹";
const GT = "›";

/** Neutralize angle brackets so untrusted text cannot close the evidence block. */
export function neutralize(value: string): string {
  return value.replaceAll("<", LT).replaceAll(">", GT);
}

/** Redact, then keep the head and tail of a log with a truncation marker. */
export function headTail(value: string, head: number, tail: number): string {
  const clean = neutralize(redactText(value));
  const bytes = Buffer.from(clean, "utf8");
  if (bytes.length <= head + tail) {
    return clean;
  }
  const cut = bytes.length - head - tail;
  const start = bytes.subarray(0, head).toString("utf8");
  const end = bytes.subarray(bytes.length - tail).toString("utf8");
  return `${start}\n[truncated ${cut} bytes]\n${end}`;
}

/** Single-line, redacted, neutralized field (names, messages, paths). */
export function field(value: string | null | undefined, max = 200): string {
  const line = neutralize(redactText(value ?? ""))
    .replaceAll(/\s+/gu, " ")
    .trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/** Cap total text bytes at a line boundary with an explicit marker. */
export function capBytes(lines: string[], maxBytes: number): string {
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const size = Buffer.byteLength(line, "utf8") + 1;
    if (used + size > maxBytes) {
      kept.push(`[evidence truncated: ${lines.length - kept.length} lines omitted]`);
      break;
    }
    kept.push(line);
    used += size;
  }
  return kept.join("\n");
}
