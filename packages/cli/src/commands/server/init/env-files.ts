import type { Answers } from "./answers.ts";
import { requiredEnv } from "./codegen.ts";

/** What each variable is for, as a comment line in `.env.example` and a row in the scaffold README. */
const ENV_HELP: Record<string, { example: string; note: string }> = {
  SECRET: {
    example: "",
    note: "at least 32 random characters; generate with `openssl rand -hex 32`, keep it and reuse it",
  },
  PUBLIC_BASE_URL: {
    example: "http://localhost:3000",
    note: "the URL people open in a browser (no trailing slash)",
  },
  AUTH_PASSWORD: { example: "", note: "the first admin's password, 12 or more characters" },
  DATABASE_URL: { example: "", note: "the database connection string" },
};

/** Optional variables every scaffold reads, commented out in `.env.example`. */
const OPTIONAL_ENV: readonly (readonly [string, string, string])[] = [
  ["PORT", "3000", "the port to listen on"],
  ["DATA_DIR", "./data", "where the SQLite file and local uploads live"],
  [
    "STORYSHELF_ADMIN_TOKEN",
    "",
    "lets `storyshelf create --token` bootstrap a project from the command line",
  ],
];

/** The `.env.example` of a scaffold: required variables first, optional ones commented out. */
export function generateEnvExample(answers: Answers): string {
  const required = requiredEnv(answers).map((name) => {
    const help = ENV_HELP[name];
    return `# ${help?.note ?? name}\n${name}=${help?.example ?? ""}`;
  });
  const optional = OPTIONAL_ENV.map(([name, value, note]) => `# ${note}\n# ${name}=${value}`);
  return [
    "# Copy to .env and fill in; the server reads it at start. Never commit .env.",
    ...(required.length > 0 ? ["", "# Required", ...required] : []),
    "",
    "# Optional",
    ...optional,
    "",
  ].join("\n");
}

/** The short README of a scaffold: start, sign in, get a first build. */
export function generateReadme(answers: Answers): string {
  const names = requiredEnv(answers);
  const signIn =
    answers.auth === "password"
      ? "Open the URL you set as `PUBLIC_BASE_URL` and sign in as `admin@example.com` with `AUTH_PASSWORD`."
      : "Open http://localhost:3000.";
  const variables = names.map((name) => `- \`${name}\`: ${ENV_HELP[name]?.note ?? name}`);
  return [
    `# ${answers.name}`,
    "",
    "A StoryShelf server, scaffolded by `storyshelf server init`.",
    "",
    "## Start",
    "",
    ...(names.length > 0
      ? ["Copy `.env.example` to `.env` and set the required variables:", "", ...variables, ""]
      : []),
    "```sh",
    "npm install",
    "npm start",
    "```",
    "",
    signIn,
    "",
    "## Get your first build",
    "",
    "Create a project in the UI. The project page's **Get your first build** card shows a token",
    "and the command. From your Storybook project:",
    "",
    "```sh",
    "npx storyshelf init --url <PUBLIC_BASE_URL> --slug <slug>",
    "STORYSHELF_TOKEN=<token> npx storyshelf upload",
    "```",
    "",
    "Docs: https://storyshelf.js.org/guides/getting-started/",
    "",
  ].join("\n");
}
