/**
 * StoryShelf's renamed environment variables (#1308): each `SHELF_*` name with the old names it
 * replaces. The old names are **not** read (owner policy #1309: no compatibility before 2027-01-01).
 * Boot refuses to start while one is set (`refuseRenamedSettings`), so an upgrade never silently
 * drops a setting; `SHELF_ALLOW_OLD_NAMES=1` lets it start with a warning when another service owns
 * a generic name. This file is the only source that names an old variable.
 *
 * End date: the guard and this table are removed in the first release of 2027. After that the
 * ratchet (`ratchet.test.ts`) alone keeps the old names from coming back.
 */
export const RENAMED_SETTINGS = {
  // Secrets and access
  SHELF_SECRET: ["SECRET"],
  SHELF_SECRET_PREVIOUS: ["SECRET_PREVIOUS"],
  SHELF_SECRET_MIGRATE: ["SECRET_MIGRATE"],
  SHELF_ADMIN_TOKEN: ["ADMIN_TOKEN", "STORYSHELF_ADMIN_TOKEN"],
  // The password admin account (packages/auth/src/bootstrap.ts)
  SHELF_ADMIN_PASSWORD: ["AUTH_PASSWORD"],
  SHELF_ADMIN_EMAIL: ["AUTH_EMAIL"],
  // Server settings
  SHELF_PUBLIC_BASE_URL: ["PUBLIC_BASE_URL"],
  SHELF_DATA_DIR: ["DATA_DIR"],
  SHELF_TRUST_PROXY: ["TRUST_PROXY"],
  SHELF_LOG_LEVEL: ["LOG_LEVEL"],
  SHELF_CAPTURE_CONCURRENCY: ["CAPTURE_CONCURRENCY", "STORYSHELF_CAPTURE_CONCURRENCY"],
  SHELF_PURGE_TTL_DAYS: ["PURGE_TTL_DAYS"],
  SHELF_SHUTDOWN_GRACE_SECONDS: ["SHUTDOWN_GRACE_SECONDS"],
  SHELF_ALLOW_SERVERLESS: ["STORYSHELF_ALLOW_SERVERLESS"],
  SHELF_DIFF_WORKERS: ["STORYSHELF_DIFF_WORKERS"],
  SHELF_IMAGE_ENGINE: ["STORYSHELF_IMAGE_ENGINE"],
  SHELF_REUSE_PAGES: ["STORYSHELF_REUSE_PAGES"],
  SHELF_BROWSER_RECYCLE_EVERY: ["STORYSHELF_BROWSER_RECYCLE_EVERY"],
  SHELF_NAVIGATION_TIMEOUT_MS: ["STORYSHELF_NAVIGATION_TIMEOUT_MS"],
  SHELF_OTEL_ENABLED: ["STORYSHELF_OTEL_ENABLED"],
  SHELF_OTEL_METRICS_INTERVAL_MS: ["STORYSHELF_OTEL_METRICS_INTERVAL_MS"],
  // Storage: one S3 name, not three
  // BUCKET_NAME is not here: Fly's `fly storage create` (Tigris) injects it, so it is a platform name
  // (see UNPREFIXED_ALLOWED and `readS3Bucket`).
  SHELF_S3_BUCKET: ["AWS_BUCKET", "S3_BUCKET"],
  SHELF_GCS_BUCKET: ["GCS_BUCKET"],
  SHELF_AZURE_ACCOUNT: ["AZURE_STORAGE_ACCOUNT"],
  SHELF_AZURE_CONTAINER: ["AZURE_STORAGE_CONTAINER"],
  SHELF_AZURE_CONNECTION_STRING: ["AZURE_STORAGE_CONNECTION"],
  // Database (`DATABASE_URL` stays: platforms inject it)
  SHELF_DATABASE_CA: ["DATABASE_CA"],
  SHELF_DATABASE_CA_FILE: ["DATABASE_CA_FILE"],
  SHELF_DATABASE_POOL_MAX: ["DATABASE_POOL_MAX"],
  SHELF_DATABASE_IAM_HOST: ["DATABASE_IAM_HOST"],
  SHELF_DATABASE_IAM_USER: ["DATABASE_IAM_USER"],
  SHELF_DATABASE_IAM_NAME: ["DATABASE_IAM_NAME"],
  SHELF_DATABASE_IAM_REGION: ["DATABASE_IAM_REGION"],
  SHELF_DATABASE_IAM_PORT: ["DATABASE_IAM_PORT"],
  // Email
  SHELF_SMTP_HOST: ["SMTP_HOST"],
  SHELF_SMTP_PORT: ["SMTP_PORT"],
  SHELF_SMTP_SECURE: ["SMTP_SECURE"],
  SHELF_SMTP_USER: ["SMTP_USER"],
  SHELF_SMTP_PASS: ["SMTP_PASS"],
  SHELF_SMTP_FROM: ["SMTP_FROM"],
  SHELF_SES_REGION: ["SES_REGION"],
  SHELF_SES_SMTP_USER: ["SES_SMTP_USER"],
  SHELF_SES_SMTP_PASS: ["SES_SMTP_PASS"],
  SHELF_SES_FROM: ["SES_FROM"],
  // Sign-in and design
  SHELF_OIDC_ISSUER: ["OIDC_ISSUER"],
  SHELF_OIDC_CLIENT_ID: ["OIDC_CLIENT_ID"],
  SHELF_OIDC_CLIENT_SECRET: ["OIDC_CLIENT_SECRET"],
  SHELF_FIGMA_CLIENT_ID: ["FIGMA_CLIENT_ID"],
  SHELF_FIGMA_CLIENT_SECRET: ["FIGMA_CLIENT_SECRET"],
  // The CLI and MCP server (`SHELF_TOKEN` already existed)
  SHELF_URL: ["STORYSHELF_URL", "STORYSHELF_HOST"],
  SHELF_TOKEN: ["STORYSHELF_TOKEN"],
  SHELF_SLUG: ["STORYSHELF_SLUG"],
  SHELF_FULL: ["STORYSHELF_FULL"],
  SHELF_ZIP: ["STORYSHELF_ZIP"],
  SHELF_SKIP_UNCHANGED: ["STORYSHELF_SKIP_UNCHANGED"],
} as const satisfies Readonly<Record<`SHELF_${string}`, readonly string[]>>;

/** A `SHELF_*` name that replaced old names. */
export type RenamedSetting = keyof typeof RENAMED_SETTINGS;

/** Any of StoryShelf's own variable names. */
export type SettingName = `SHELF_${string}`;

/**
 * Names StoryShelf reads without the prefix because a platform, SDK or specification defines them
 * and StoryShelf reads them with that exact meaning. Each entry is an exact name, or a prefix ending
 * in `_` that covers a family. The ratchet test (`ratchet.test.ts`) refuses any other unprefixed name.
 */
export const UNPREFIXED_ALLOWED: readonly string[] = [
  // Platforms inject these
  "PORT",
  "HOST",
  "NODE_ENV",
  "NODE_OPTIONS",
  "NO_COLOR",
  "DATABASE_URL",
  // Cloudflare's D1 binding (`env.DB` in a Worker), not a process variable
  "DB",
  // Cloud SDKs
  "AWS_",
  // Fly's Tigris attachment (`fly storage create`) injects it beside AWS_ENDPOINT_URL_S3 and the AWS
  // keys; read only as the S3 bucket when SHELF_S3_BUCKET is unset (`readS3Bucket`).
  "BUCKET_NAME",
  "AZURE_CLIENT_ID",
  "GOOGLE_CLOUD_PROJECT",
  // Specifications and third-party SDKs
  "OTEL_",
  "PLAYWRIGHT_SERVICE_",
  "PLAYWRIGHT_BROWSERS_PATH",
  "PUPPETEER_EXECUTABLE_PATH",
  "ANTHROPIC_API_KEY",
  "TURSO_",
  "BETTER_AUTH_SECRETS",
  "GITLAB_TOKEN",
  // Read-only platform facts
  "CI",
  "CI_",
  "GITHUB_",
  "VERCEL_",
  "FLY_APP_NAME",
  "CONTAINER_APP_",
  "DEPLOY_PRIME_URL",
  "DIGITALOCEAN_APP_ID",
  "HEROKU_APP_DEFAULT_DOMAIN_NAME",
  "RAILWAY_PUBLIC_DOMAIN",
  "RENDER_EXTERNAL_",
  "WEBSITE_HOSTNAME",
];
