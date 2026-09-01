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
    name: "database",
    message: "Which database?",
    choices: [
      { title: "SQLite (local)", value: "sqlite" },
      { title: "Turso (serverless)", value: "turso" },
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
    ],
  },
  {
    type: "confirm",
    name: "docker",
    message: "Generate Docker files?",
    initial: true,
  },
];
