interface PromptChoice {
  title: string;
  value: string;
}

interface ProjectPrompt {
  type: "text";
  name: string;
  message: string;
  initial: string | ((prev: string) => string);
}

interface SelectPrompt {
  type: "select";
  name: string;
  message: string;
  choices: PromptChoice[];
  initial?: number;
}

interface ConfirmPrompt {
  type: "confirm";
  name: string;
  message: string;
  initial: boolean;
}

export type Prompt = ProjectPrompt | SelectPrompt | ConfirmPrompt;

export const PROJECT_PROMPTS: Prompt[] = [
  {
    type: "text",
    name: "name",
    message: "Project name?",
    initial: "my-storyshelf",
  },
  {
    type: "text",
    name: "dir",
    message: "Directory?",
    initial: (prev: string): string => `./${prev}`,
  },
];

export const DEPLOY_TARGET_PROMPT: SelectPrompt = {
  type: "select",
  name: "deployTarget",
  message: "Deploy target?",
  choices: [
    { title: "Local (bare node)", value: "local" },
    { title: "Docker (compose)", value: "docker" },
    { title: "AWS (ECS + S3 + Postgres + Cognito)", value: "aws" },
    {
      title: "Azure (Container Apps + Blob + Postgres + Entra)",
      value: "azure",
    },
    {
      title: "Google Cloud (Cloud Run + GCS + Postgres + Identity Platform)",
      value: "gcp",
    },
  ],
};

/**
 * Curated shortlists for the local/docker path — one per engine plus the
 * zero-config default first. Everything else lives behind the advanced
 * toggle so newcomers pick from 4 databases, not 14.
 */
export const CURATED_DATABASE_CHOICES: PromptChoice[] = [
  { title: "SQLite (node:sqlite, local)", value: "sqlite" },
  { title: "Postgres (postgres.js, default)", value: "postgres" },
  { title: "MySQL / MariaDB (mysql2)", value: "mysql" },
  { title: "PGlite (embedded WASM Postgres)", value: "pglite" },
];

export const ADVANCED_DATABASE_CHOICES: PromptChoice[] = [
  { title: "Turso (libSQL, serverless)", value: "turso" },
  { title: "better-sqlite3 (native, local)", value: "better-sqlite3" },
  { title: "Bun SQLite (bun:sqlite)", value: "bun-sqlite" },
  { title: "Cloudflare D1 (serverless edge)", value: "d1" },
  { title: "Postgres pg (node-postgres, pooler-safe)", value: "pg" },
  { title: "Neon (serverless Postgres)", value: "neon" },
  { title: "Neon HTTP (fetch, edge)", value: "neon-http" },
  { title: "Vercel Postgres", value: "vercel" },
  { title: "PlanetScale (serverless MySQL)", value: "planetscale" },
  { title: "TiDB Serverless (MySQL)", value: "tidb" },
];

export const CURATED_STORAGE_CHOICES: PromptChoice[] = [
  { title: "Local filesystem", value: "local" },
  { title: "S3-compatible", value: "s3" },
];

export const ADVANCED_STORAGE_CHOICES: PromptChoice[] = [
  { title: "Azure Blob Storage", value: "azure" },
  { title: "GCS (Google Cloud Storage)", value: "gcs" },
];

/** Opt-in to the full adapter matrix on the local/docker path. */
export const ADVANCED_ADAPTERS_PROMPT: ConfirmPrompt = {
  type: "confirm",
  name: "advancedAdapters",
  message: "Show all adapter options (serverless/edge presets)?",
  initial: false,
};

/** Database choices for the local/docker path. */
export function databaseChoices(advanced: boolean): PromptChoice[] {
  return advanced
    ? [...CURATED_DATABASE_CHOICES, ...ADVANCED_DATABASE_CHOICES]
    : [...CURATED_DATABASE_CHOICES];
}

/** Storage choices for the local/docker path. */
export function storageChoices(advanced: boolean): PromptChoice[] {
  return advanced
    ? [...CURATED_STORAGE_CHOICES, ...ADVANCED_STORAGE_CHOICES]
    : [...CURATED_STORAGE_CHOICES];
}

/**
 * Full adapter matrix — shown only when the advanced toggle is on, or to
 * resolve a stored/detected value. Prefer the `*Choices()` helpers for new
 * prompts so the curated shortlist stays the default.
 */
export const INFRA_PROMPTS: Prompt[] = [
  DEPLOY_TARGET_PROMPT,
  {
    type: "select",
    name: "database",
    message: "Which database?",
    choices: [
      { title: "SQLite (node:sqlite, local)", value: "sqlite" },
      { title: "Turso (libSQL, serverless)", value: "turso" },
      { title: "better-sqlite3 (native, local)", value: "better-sqlite3" },
      { title: "Bun SQLite (bun:sqlite)", value: "bun-sqlite" },
      { title: "Cloudflare D1 (serverless edge)", value: "d1" },
      { title: "Postgres (postgres.js, default)", value: "postgres" },
      { title: "Postgres pg (node-postgres, pooler-safe)", value: "pg" },
      { title: "Neon (serverless Postgres)", value: "neon" },
      { title: "Neon HTTP (fetch, edge)", value: "neon-http" },
      { title: "Vercel Postgres", value: "vercel" },
      { title: "PGlite (embedded WASM Postgres)", value: "pglite" },
      { title: "MySQL / MariaDB (mysql2)", value: "mysql" },
      { title: "PlanetScale (serverless MySQL)", value: "planetscale" },
      { title: "TiDB Serverless (MySQL)", value: "tidb" },
    ],
  },
  {
    type: "select",
    name: "storage",
    message: "Which storage?",
    choices: [
      { title: "Local filesystem", value: "local" },
      { title: "S3-compatible", value: "s3" },
      { title: "GCS (Google Cloud Storage)", value: "gcs" },
    ],
  },
  {
    type: "select",
    name: "auth",
    message: "Which auth?",
    choices: [
      { title: "None", value: "none" },
      { title: "Local accounts", value: "password" },
      { title: "OAuth/OIDC", value: "oauth" },
    ],
  },
  {
    type: "select",
    name: "git",
    message: "Post build statuses to a git host?",
    choices: [
      { title: "No", value: "none" },
      { title: "Yes: GitHub or GitLab (configure channels in project settings)", value: "git" },
    ],
  },
  {
    type: "confirm",
    name: "docker",
    message: "Generate Docker files?",
    initial: true,
  },
  {
    type: "confirm",
    name: "notifications",
    message: "Enable email + chat notifications (Slack/Teams/email channels)?",
    initial: false,
  },
  {
    type: "confirm",
    name: "observability",
    message: "Add OpenTelemetry tracing + metrics wiring?",
    initial: false,
  },
];

const AUTH_SELECT: SelectPrompt = {
  type: "select",
  name: "auth",
  message: "Which auth?",
  choices: [
    { title: "None", value: "none" },
    { title: "Local accounts", value: "password" },
    { title: "OAuth/OIDC", value: "oauth" },
  ],
};

const GIT_SELECT: SelectPrompt = {
  type: "select",
  name: "git",
  message: "Post build statuses to a git host?",
  choices: [
    { title: "No", value: "none" },
    { title: "Yes: GitHub or GitLab (configure channels in project settings)", value: "git" },
  ],
};

const DOCKER_CONFIRM: ConfirmPrompt = {
  type: "confirm",
  name: "docker",
  message: "Generate Docker files?",
  initial: true,
};

const NOTIFICATIONS_CONFIRM: ConfirmPrompt = {
  type: "confirm",
  name: "notifications",
  message: "Enable email + chat notifications (Slack/Teams/email channels)?",
  initial: false,
};

const DESIGN_CONFIRM: ConfirmPrompt = {
  type: "confirm",
  name: "design",
  message: "Link components to Figma designs (adds @storyshelf/design-figma)?",
  initial: true,
};

const OBSERVABILITY_CONFIRM: ConfirmPrompt = {
  type: "confirm",
  name: "observability",
  message: "Add OpenTelemetry tracing + metrics wiring?",
  initial: false,
};

/**
 * Curated prompts for the local/docker path — deploy target is asked first
 * (phase 1), then these (phase 2) with the shortlist or full matrix behind
 * the advanced toggle.
 */
export function localInfraPrompts(advanced: boolean): Prompt[] {
  return [
    {
      type: "select",
      name: "database",
      message: "Which database?",
      choices: databaseChoices(advanced),
    },
    {
      type: "select",
      name: "storage",
      message: "Which storage?",
      choices: storageChoices(advanced),
    },
    AUTH_SELECT,
    GIT_SELECT,
    DOCKER_CONFIRM,
    NOTIFICATIONS_CONFIRM,
    DESIGN_CONFIRM,
    OBSERVABILITY_CONFIRM,
  ];
}

/** Follow-up prompts for the GCP deploy target (single prompts call). */
export const GCP_INFRA_PROMPTS: Prompt[] = [
  {
    type: "text",
    name: "gcpProjectId",
    message: "GCP project ID?",
    initial: "",
  },
  {
    type: "text",
    name: "gcpLocation",
    message: "GCP region?",
    initial: "us-central1",
  },
  {
    type: "text",
    name: "domainName",
    message: "Public domain for the app? (empty skips DNS)",
    initial: "",
  },
  {
    type: "text",
    name: "identityTenant",
    message: "Identity Platform tenant display name? (empty skips it)",
    initial: "",
  },
];

/** Follow-up prompts for the Azure deploy target (single prompts call). */
export const AZURE_INFRA_PROMPTS: Prompt[] = [
  {
    type: "text",
    name: "azureLocation",
    message: "Azure region?",
    initial: "eastus",
  },
  {
    type: "text",
    name: "domainName",
    message: "Public domain for the app? (empty skips DNS)",
    initial: "",
  },
  {
    type: "text",
    name: "entraTenantId",
    message: "Entra tenant ID for the app registration? (empty skips it)",
    initial: "",
  },
];

/** Follow-up prompts for the AWS deploy target (single prompts call). */
export const AWS_INFRA_PROMPTS: Prompt[] = [
  {
    type: "text",
    name: "awsRegion",
    message: "AWS region?",
    initial: "us-east-1",
  },
  {
    type: "select",
    name: "dbEngine",
    message: "Postgres engine?",
    choices: [
      { title: "RDS (VPC-isolated, battle-tested)", value: "rds" },
      { title: "Aurora DSQL (serverless)", value: "dsql" },
    ],
  },
  {
    type: "text",
    name: "domainName",
    message: "Public domain for the ALB? (empty leaves it HTTP-only)",
    initial: "",
  },
  {
    type: "text",
    name: "samlMetadataUrl",
    message: "SAML metadata URL for Cognito federation? (empty skips it)",
    initial: "",
  },
];
