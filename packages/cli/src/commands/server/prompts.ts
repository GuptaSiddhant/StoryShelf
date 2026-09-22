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

export const INFRA_PROMPTS: Prompt[] = [
  {
    type: "select",
    name: "deployTarget",
    message: "Deploy target?",
    choices: [
      { title: "Local (bare node)", value: "local" },
      { title: "Docker (compose)", value: "docker" },
      { title: "AWS (ECS + S3 + SQS + Postgres + Cognito)", value: "aws" },
      {
        title: "Azure (Container Apps + Blob + Queues/Service Bus + Postgres + Entra)",
        value: "azure",
      },
    ],
  },
  {
    type: "select",
    name: "database",
    message: "Which database?",
    choices: [
      { title: "SQLite (local)", value: "sqlite" },
      { title: "Turso (serverless)", value: "turso" },
      { title: "Postgres (RDS/Cloud SQL/Supabase/Neon/self-hosted)", value: "postgres" },
    ],
  },
  {
    type: "select",
    name: "storage",
    message: "Which storage?",
    choices: [
      { title: "Local filesystem", value: "local" },
      { title: "S3-compatible", value: "s3" },
    ],
  },
  {
    type: "select",
    name: "auth",
    message: "Which auth?",
    choices: [
      { title: "None", value: "none" },
      { title: "Shared password", value: "password" },
      { title: "OAuth/OIDC", value: "oauth" },
    ],
  },
  {
    type: "select",
    name: "git",
    message: "Which git provider?",
    choices: [
      { title: "None", value: "none" },
      { title: "GitHub", value: "github" },
      { title: "GitLab", value: "gitlab" },
    ],
  },
  {
    type: "select",
    name: "queue",
    message: "Which capture queue?",
    choices: [
      { title: "In-memory (single server)", value: "memory" },
      { title: "Redis (self-hosted, Docker Compose)", value: "redis" },
      { title: "SQS (AWS remote worker)", value: "sqs" },
      {
        title: "Azure Storage Queues (Azurite-local, remote worker)",
        value: "azure-storage-queues",
      },
      {
        title: "Azure Service Bus (native dead-lettering, remote worker)",
        value: "azure-service-bus",
      },
    ],
  },
  {
    type: "confirm",
    name: "docker",
    message: "Generate Docker files?",
    initial: true,
  },
];

export const WORKER_INFRA_PROMPTS: Prompt[] = [
  {
    type: "select",
    name: "database",
    message: "Which database?",
    choices: [
      { title: "SQLite (local)", value: "sqlite" },
      { title: "Turso (serverless)", value: "turso" },
      { title: "Postgres (RDS/Cloud SQL/Supabase/Neon/self-hosted)", value: "postgres" },
    ],
  },
  {
    type: "select",
    name: "storage",
    message: "Which storage?",
    choices: [
      { title: "Local filesystem", value: "local" },
      { title: "S3-compatible", value: "s3" },
    ],
  },
  {
    type: "select",
    name: "queue",
    message: "Which queue?",
    choices: [
      { title: "SQS (AWS)", value: "sqs" },
      { title: "Redis (self-hosted)", value: "redis" },
      { title: "Azure Storage Queues", value: "azure-storage-queues" },
      { title: "Azure Service Bus", value: "azure-service-bus" },
      { title: "In-memory (local dev only)", value: "memory" },
    ],
  },
  {
    type: "confirm",
    name: "docker",
    message: "Generate Docker files?",
    initial: true,
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
    type: "select",
    name: "azureQueueBackend",
    message: "Azure capture queue backend?",
    choices: [
      { title: "Storage Queues (Azurite-testable, visibility-timeout)", value: "storage-queues" },
      { title: "Service Bus (native dead-lettering, SQS + DLQ parity)", value: "service-bus" },
    ],
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
