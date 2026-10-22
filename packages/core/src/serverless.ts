/**
 * Serverless hosts (ADR 0006, decision 3): `testing` needs a process that keeps running between
 * requests, so it is refused on AWS Lambda and warned about on the other platforms that freeze or
 * end the process after each request. Hosting only works everywhere.
 */

/** Set by AWS Lambda; the one host where `testing` is refused outright. */
const LAMBDA_ENV = "AWS_LAMBDA_FUNCTION_NAME";

/** Platforms that freeze or end the process after each request. */
const SERVERLESS_ENV = [LAMBDA_ENV, "VERCEL", "NETLIFY"] as const;

/** Escape hatch for hosts that look serverless but keep a process alive. */
export const ALLOW_SERVERLESS_ENV = "STORYSHELF_ALLOW_SERVERLESS";

/** Whether the host ends or freezes the process after each request (Lambda, Vercel, Netlify). */
export function isServerlessHost(env: NodeJS.ProcessEnv = process.env): boolean {
  return SERVERLESS_ENV.some((name) => Boolean(env[name]));
}

/**
 * Boot check for `testing` on a serverless host. Returns a warning to log, or `undefined` when
 * there is nothing to say; throws on AWS Lambda. Does nothing without `testing`, or when
 * `STORYSHELF_ALLOW_SERVERLESS=1`.
 */
export function assertServerless(
  testing: boolean,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!testing || env[ALLOW_SERVERLESS_ENV] === "1" || !isServerlessHost(env)) {
    return undefined;
  }
  if (env[LAMBDA_ENV]) {
    throw new Error(
      `testing needs a long-running server, and AWS Lambda ends the process after each request. ` +
        `Remove the testing option to host Storybooks only, or run on a container; set ` +
        `${ALLOW_SERVERLESS_ENV}=1 to override.`,
    );
  }
  return (
    `testing is configured on a serverless host: capture jobs run in the background and may be ` +
    `cut off when the platform ends the process. Run on a container for testing; set ` +
    `${ALLOW_SERVERLESS_ENV}=1 to silence this warning.`
  );
}
