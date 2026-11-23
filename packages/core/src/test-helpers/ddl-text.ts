/** Text helpers for the DDL shape parser (spike #800): statements, identifiers, top-level lists. */

/** An identifier without its quotes. */
export function unquote(value: string): string {
  return value.trim().replace(/^["`](?<inner>.*)["`]$/u, "$<inner>");
}

/** A comma-separated identifier list, unquoted. */
export function identList(value: string): string[] {
  return value.split(",").map((part) => unquote(part));
}

/** Split on commas outside parentheses and quotes. */
export function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const char of body) {
    quoted = char === "'" ? !quoted : quoted;
    depth += quoted ? 0 : Number(char === "(") - Number(char === ")");
    if (char === "," && depth === 0 && !quoted) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  return [...parts, current.trim()].filter((part) => part !== "");
}

/** Split SQL text into statements, dropping `--` comments and collapsing whitespace. */
export function statementsOf(sqlText: string): string[] {
  return splitStatements(sqlText.replaceAll(/--[^\n]*/gu, ""))
    .map((s) => s.replaceAll(/\s+/gu, " ").trim())
    .filter((s) => s !== "");
}

function splitStatements(sqlText: string): string[] {
  const statements: string[] = [];
  let quoted = false;
  let current = "";
  for (const char of sqlText) {
    quoted = char === "'" ? !quoted : quoted;
    if (char === ";" && !quoted) {
      statements.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  return [...statements, current];
}
