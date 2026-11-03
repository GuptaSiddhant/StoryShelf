/** Story-only stand-in for `src/middleware/csrf.ts`: a fixed token, no `node:crypto`. */
export function getCsrfToken(): string {
  return "storybook-csrf-token";
}
