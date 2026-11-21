import { DB_IMPORT, DB_INIT, dbPrelude, STORAGE_IMPORT, STORAGE_INIT } from "./adapter-snippets.ts";
import { wantsNotifications, wantsObservability, type Answers } from "./answers.ts";

const NAMED_IMPORT_RE = /^import \{ (?<names>[^}]+) \} from "(?<from>[^"]+)";$/u;

/** Merge named imports that share a module into one line (keeps first-seen order). */
function mergeImports(lines: string[]): string[] {
  const merged = new Map<string, string[]>();
  for (const line of lines) {
    const match = NAMED_IMPORT_RE.exec(line);
    const key = match?.groups?.["from"] ?? line;
    const names = match?.groups?.["names"]?.split(", ") ?? [];
    merged.set(key, [...(merged.get(key) ?? []), ...names]);
  }
  return [...merged].map(([from, names]) =>
    names.length > 0 ? `import { ${names.join(", ")} } from "${from}";` : from,
  );
}

function buildImports(answers: Answers): string[] {
  return mergeImports([
    `import { defineShelfInstance } from "@storyshelf/app";`,
    DB_IMPORT[answers.database],
    STORAGE_IMPORT[answers.storage],
    `import { createCaptureRunner } from "@storyshelf/runner";`,
    ...(wantsObservability(answers) ? OBSERVABILITY_IMPORTS : []),
    ...authImports(answers),
    ...(wantsNotifications(answers) ? notificationImports(answers) : []),
  ]);
}

const OBSERVABILITY_IMPORTS = [
  `import { createShelfLogger } from "@storyshelf/core/logger";`,
  `import { otelLogMixin } from "@storyshelf/observability";`,
  `import { initObservabilityFromEnv } from "@storyshelf/observability/node";`,
];

/** The auth imports: the password admin, or the Keycloak OAuth preset. */
function authImports(answers: Answers): string[] {
  if (answers.auth === "password") {
    return [`import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";`];
  }
  if (answers.auth === "oauth") {
    return [
      `import { createShelfAuth } from "@storyshelf/auth";`,
      `import { keycloakPreset } from "@storyshelf/auth";`,
    ];
  }
  return [];
}

function notificationImports(answers: Answers): string[] {
  return [
    `import { createEmailNotifier, smtpPresetFromEnv } from "@storyshelf/core/integrations";`,
    ...(answers.auth === "none" ? [] : [`import { createAuthSystemHook } from "@storyshelf/app";`]),
  ];
}

function buildAdapterLines(answers: Answers): string[] {
  return [
    ...dbPrelude(answers.database),
    `const database = ${DB_INIT[answers.database]};`,
    `const storage = ${STORAGE_INIT[answers.storage]};`,
    `const captureRunner = createCaptureRunner();`,
    ...(wantsNotifications(answers) ? EMAIL_SENDER_LINES : []),
  ];
}

const EMAIL_SENDER_LINES = [
  `// SMTP sender from SHELF_SMTP_* env (undefined keeps invites out-of-band).`,
  `const emailSender = await smtpPresetFromEnv(process.env);`,
];

/** The built-in integrations stay registered; with SMTP, the built-in \`email\` notifier sends through it. */
const EMAIL_NOTIFIERS_LINES = [
  `  notifications: {`,
  `    // Git, chat, email and Figma are built in; this swaps the built-in email notifier for SMTP.`,
  `    notifiers: (builtIn) =>`,
  `      emailSender`,
  `        ? builtIn.map((provider) =>`,
  `            provider.metadata.kind === "email"`,
  `              ? createEmailNotifier(emailSender, { from: process.env.SHELF_SMTP_FROM })`,
  `              : provider,`,
  `          )`,
  `        : builtIn,`,
  `  },`,
];

function buildRouterLines(answers: Answers): string[] {
  return [
    ...(wantsObservability(answers) ? OBSERVABILITY_SETUP_LINES : []),
    `return {`,
    `  database,`,
    `  storage,`,
    `  testing: { runner: captureRunner },`,
    ...(wantsNotifications(answers) ? EMAIL_NOTIFIERS_LINES : []),
    ...authLines(answers),
    ...(wantsObservability(answers) ? [`  logger: shelfLogger,`, `  observability,`] : []),
    ...CONFIG_AND_SETUP_LINES,
  ];
}

const OBSERVABILITY_SETUP_LINES = [
  `// Noop unless OTEL_EXPORTER_OTLP_ENDPOINT is set.`,
  `const observability = await initObservabilityFromEnv();`,
  `const shelfLogger = createShelfLogger({ mixin: otelLogMixin });`,
  ``,
];

const CONFIG_AND_SETUP_LINES = [
  `  config: {`,
  `    // Lets \`storyshelf create --token $SHELF_ADMIN_TOKEN\` bootstrap projects; unset disables it.`,
  `    adminToken: process.env.SHELF_ADMIN_TOKEN || undefined,`,
  `    publicBaseUrl: process.env.SHELF_PUBLIC_BASE_URL || undefined,`,
  `    secret: process.env.SHELF_SECRET,`,
  `    previousSecret: process.env.SHELF_SECRET_PREVIOUS || undefined,`,
  `    migrateCredentialsOnBoot: process.env.SHELF_SECRET_MIGRATE === "true",`,
  `    scratchDir: dataDir,`,
  `  },`,
  `};`,
];

/** Runs after setup, only under \`storyshelf-server serve\`: the admin needs the migrated database. */
const PASSWORD_ADMIN_HOOK_LINES = [
  `{`,
  `  afterSetup: async ({ options }) => {`,
  `    // Provision the env-driven local admin (SHELF_ADMIN_PASSWORD, at least 12 chars).`,
  `    await ensurePasswordAdmin(options.database, {`,
  `      email: process.env.SHELF_ADMIN_EMAIL ?? "admin@example.com",`,
  `      password: process.env.SHELF_ADMIN_PASSWORD!,`,
  `    });`,
  `  },`,
  `},`,
];

const KEYCLOAK_OAUTH_LINES = [
  `    oauth: [`,
  `      keycloakPreset(process.env.SHELF_OIDC_ISSUER!, {`,
  `        clientId: process.env.SHELF_OIDC_CLIENT_ID!,`,
  `        clientSecret: process.env.SHELF_OIDC_CLIENT_SECRET,`,
  `      }),`,
  `    ],`,
];

/** The `auth:` option: the local password admin, or OAuth with Cognito on AWS and Keycloak elsewhere. */
function authLines(answers: Answers): string[] {
  if (answers.auth === "none") {
    return [];
  }
  const provider = answers.auth === "password" ? [] : KEYCLOAK_OAUTH_LINES;
  return [
    `  auth: createShelfAuth({`,
    `    db: database,`,
    `    secret: process.env.SHELF_SECRET!,`,
    `    baseURL: process.env.SHELF_PUBLIC_BASE_URL!,`,
    ...(wantsNotifications(answers) ? AUTH_NOTIFICATION_LINES : []),
    ...provider,
    `  }).adapter,`,
  ];
}

const AUTH_NOTIFICATION_LINES = [
  `    emailSender,`,
  `    fromEmail: process.env.SHELF_SMTP_FROM,`,
  `    onAuthSystemEvent: createAuthSystemHook(),`,
];

/** The variables the server cannot start without, for the chosen auth and database. */
export function requiredEnv(answers: Answers): string[] {
  const names = answers.auth === "none" ? [] : ["SHELF_SECRET", "SHELF_PUBLIC_BASE_URL"];
  if (answers.auth === "password") {
    names.push("SHELF_ADMIN_PASSWORD");
  }
  if (DB_INIT[answers.database].includes("process.env.DATABASE_URL")) {
    names.push("DATABASE_URL");
  }
  return names;
}

/** One clear line when a required variable is unset (the bin prints it and exits 1), instead of a stack trace deep in a library. */
function envCheckLines(answers: Answers): string[] {
  const names = requiredEnv(answers);
  if (names.length === 0) {
    return [];
  }
  return [
    `const missing = [${names.map((name) => `"${name}"`).join(", ")}].filter((name) => !process.env[name]);`,
    `if (missing.length > 0) {`,
    `  throw new Error(\`Set \${missing.join(", ")} before starting (see .env.example and README.md).\`);`,
    `}`,
    ``,
  ];
}

/** The module body: the factory's statements, then the options it returns. */
function factoryBody(answers: Answers): string[] {
  return [
    `const dataDir = process.env.SHELF_DATA_DIR || "./data";`,
    ``,
    ...envCheckLines(answers),
    ...buildAdapterLines(answers),
    ``,
    ...buildRouterLines(answers),
  ];
}

/**
 * \`src/index.ts\` of a scaffolded instance: the default export is a definition, never a constructed
 * app. \`storyshelf-server\` loads \`.env\`, calls the factory and creates the app for its command.
 */
export function generateServer(answers: Answers): string {
  const body = factoryBody(answers).map((line) => (line === "" ? line : `  ${line}`));
  const hooks = answers.auth === "password" ? PASSWORD_ADMIN_HOOK_LINES : [];
  return [
    ...buildImports(answers),
    ``,
    `export default defineShelfInstance(`,
    `  async () => {`,
    ...body.map((line) => (line === "" ? line : `  ${line}`)),
    `  },`,
    ...hooks.map((line) => `  ${line}`),
    `);`,
    ``,
  ].join("\n");
}
