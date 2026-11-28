import type { Answers } from "./answers.ts";
import { requiredEnv } from "./codegen.ts";

/** What each variable is for, as a comment line in `.env.example` and a row in the scaffold README. */
const ENV_HELP: Record<string, { example: string; note: string }> = {
  SHELF_SECRET: {
    example: "",
    note: "at least 32 random characters; generate with `openssl rand -hex 32`, keep it and reuse it",
  },
  SHELF_PUBLIC_BASE_URL: {
    example: "http://localhost:3000",
    note: "the URL people open in a browser (no trailing slash)",
  },
  SHELF_ADMIN_PASSWORD: { example: "", note: "the first admin's password, 12 or more characters" },
  DATABASE_URL: { example: "", note: "the database connection string" },
};

/** Optional variables every scaffold reads, commented out in `.env.example`. */
const OPTIONAL_ENV: readonly (readonly [string, string, string])[] = [
  ["PORT", "3000", "the port to listen on"],
  ["SHELF_DATA_DIR", "./data", "where local uploads live"],
  [
    "SHELF_ADMIN_TOKEN",
    "",
    "lets `storyshelf create --token` bootstrap a project from the command line",
  ],
];

/** The databases that keep their file in `SHELF_DATA_DIR`. */
const FILE_DATABASES: ReadonlySet<Answers["database"]> = new Set([
  "sqlite",
  "better-sqlite3",
  "bun-sqlite",
]);

/** A `DATABASE_URL` that shows the shape: MySQL-family servers use `mysql://`, the rest `postgres://`. */
export function databaseUrlExample(database: Answers["database"]): string {
  return ["mysql", "planetscale", "tidb"].includes(database)
    ? "mysql://user:password@host:3306/dbname"
    : "postgres://user:password@host:5432/dbname";
}

/** The optional variables; `SHELF_DATA_DIR` holds the database file only for a file database. */
function optionalEnv(answers: Answers): readonly (readonly [string, string, string])[] {
  return OPTIONAL_ENV.map(([name, value, note]) =>
    name === "SHELF_DATA_DIR" && FILE_DATABASES.has(answers.database)
      ? [name, value, "where the SQLite file and local uploads live"]
      : [name, value, note],
  );
}

/** The `.env.example` of a scaffold: required variables first, optional ones commented out. */
export function generateEnvExample(answers: Answers): string {
  const optional = optionalEnv(answers).map(
    ([name, value, note]) => `# ${note}\n# ${name}=${value}`,
  );
  const required = requiredEnv(answers).map((name) => {
    const help = ENV_HELP[name];
    const example = name === "DATABASE_URL" ? databaseUrlExample(answers.database) : help?.example;
    return `# ${help?.note ?? name}\n${name}=${example ?? ""}`;
  });
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
      ? "Open the URL you set as `SHELF_PUBLIC_BASE_URL` and sign in as `admin@example.com` with `SHELF_ADMIN_PASSWORD`."
      : "Open http://localhost:3000.";
  const variables = names.map((name) => `- \`${name}\`: ${ENV_HELP[name]?.note ?? name}`);
  return [
    `# ${answers.name}`,
    "",
    "A StoryShelf server, scaffolded by `create-storyshelf`.",
    "",
    "## Start",
    "",
    ...(names.length > 0
      ? ["Copy `.env.example` to `.env` and set the required variables:", "", ...variables, ""]
      : []),
    "```sh",
    "npm install",
    "npx playwright-core install chromium   # once; add --with-deps on Linux",
    "npm start",
    "```",
    "",
    "The server renders stories in a browser that `npm install` does not download. Use `playwright-core`",
    "from this project (not `npx playwright`, which fetches a different revision).",
    "",
    signIn,
    "",
    "## Get your first build",
    "",
    "Create a project in the UI. The project page's **Get your first build** card shows a token",
    "and the command. From your Storybook project:",
    "",
    "```sh",
    "npx storyshelf init --url <SHELF_PUBLIC_BASE_URL> --slug <slug>",
    "SHELF_TOKEN=<token> npx storyshelf upload",
    "```",
    "",
    "Docs: https://storyshelf.js.org/guides/getting-started/",
    "",
  ].join("\n");
}
