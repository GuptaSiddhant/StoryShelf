/**
 * Whether the host freezes or ends the process after each request, so no background consumer can
 * run between requests (Lambda, Vercel, Netlify). Kept in one place: the full serverless refusal
 * for `testing` reuses it.
 */
const SERVERLESS_ENV = ["AWS_LAMBDA_FUNCTION_NAME", "VERCEL", "NETLIFY"] as const;

export function isServerlessHost(env: NodeJS.ProcessEnv = process.env): boolean {
  return SERVERLESS_ENV.some((name) => Boolean(env[name]));
}
