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
    `import { serve } from "@hono/node-server";`,
    `import { createShelfApp } from "@storyshelf/app";`,
    DB_IMPORT[answers.database],
    STORAGE_IMPORT[answers.storage],
    `import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";`,
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
    `const captureRunner = createPlaywrightCaptureRunner();`,
    ...(wantsNotifications(answers) ? EMAIL_SENDER_LINES : []),
  ];
}

const EMAIL_SENDER_LINES = [
  `// SMTP sender from SMTP_* env (undefined keeps invites out-of-band).`,
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
  `              ? createEmailNotifier(emailSender, { from: process.env.SMTP_FROM })`,
  `              : provider,`,
  `          )`,
  `        : builtIn,`,
  `  },`,
];

function buildRouterLines(answers: Answers): string[] {
  return [
    ...(wantsObservability(answers) ? OBSERVABILITY_SETUP_LINES : []),
    `const app = createShelfApp({`,
    `  database,`,
    `  storage,`,
    `  testing: { runner: captureRunner },`,
    ...(wantsNotifications(answers) ? EMAIL_NOTIFIERS_LINES : []),
    ...authLines(answers),
    ...(wantsObservability(answers) ? [`  logger: shelfLogger,`, `  observability,`] : []),
    ...CONFIG_AND_SETUP_LINES,
    ...(answers.auth === "password" ? PASSWORD_ADMIN_LINES : []),
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
  `    // Lets \`storyshelf create --token $STORYSHELF_ADMIN_TOKEN\` bootstrap projects; unset disables it.`,
  `    adminToken: process.env.STORYSHELF_ADMIN_TOKEN || undefined,`,
  `    publicBaseUrl: process.env.PUBLIC_BASE_URL || undefined,`,
  `    secret: process.env.SECRET,`,
  `    previousSecret: process.env.SECRET_PREVIOUS || undefined,`,
  `    migrateCredentialsOnBoot: process.env.SECRET_MIGRATE === "true",`,
  `    scratchDir: dataDir,`,
  `  },`,
  `});`,
  ``,
  `await app.lifecycle.setup();`,
];

const PASSWORD_ADMIN_LINES = [
  ``,
  `// Provision the env-driven local admin (AUTH_PASSWORD, at least 12 chars).`,
  `await ensurePasswordAdmin(database, {`,
  `  email: process.env.AUTH_EMAIL ?? "admin@example.com",`,
  `  password: process.env.AUTH_PASSWORD!,`,
  `});`,
];

const KEYCLOAK_OAUTH_LINES = [
  `    oauth: [`,
  `      keycloakPreset(process.env.OIDC_ISSUER!, {`,
  `        clientId: process.env.OIDC_CLIENT_ID!,`,
  `        clientSecret: process.env.OIDC_CLIENT_SECRET,`,
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
    `    secret: process.env.SECRET!,`,
    `    baseURL: process.env.PUBLIC_BASE_URL!,`,
    ...(wantsNotifications(answers) ? AUTH_NOTIFICATION_LINES : []),
    ...provider,
    `  }).adapter,`,
  ];
}

const AUTH_NOTIFICATION_LINES = [
  `    emailSender,`,
  `    fromEmail: process.env.SMTP_FROM,`,
  `    onAuthSystemEvent: createAuthSystemHook(),`,
];

/** The variables the server cannot start without, for the chosen auth and database. */
export function requiredEnv(answers: Answers): string[] {
  const names = answers.auth === "none" ? [] : ["SECRET", "PUBLIC_BASE_URL"];
  if (answers.auth === "password") {
    names.push("AUTH_PASSWORD");
  }
  if (DB_INIT[answers.database].includes("process.env.DATABASE_URL")) {
    names.push("DATABASE_URL");
  }
  return names;
}

/** Read `.env` when there is one (the scaffold ships `.env.example`); the shell's variables win. */
const LOAD_ENV_LINES = [
  `// Read .env when there is one (see .env.example); variables already set in the shell win.`,
  `try {`,
  `  process.loadEnvFile();`,
  `} catch {`,
  `  // no .env: the shell's variables are used`,
  `}`,
  ``,
];

/** One clear line and exit 1 when a required variable is unset, instead of a stack trace deep in a library. */
function envCheckLines(answers: Answers): string[] {
  const names = requiredEnv(answers);
  if (names.length === 0) {
    return [];
  }
  return [
    `const missing = [${names.map((name) => `"${name}"`).join(", ")}].filter((name) => !process.env[name]);`,
    `if (missing.length > 0) {`,
    `  console.error(\`Set \${missing.join(", ")} before starting (see .env.example and README.md).\`);`,
    `  process.exit(1);`,
    `}`,
    ``,
  ];
}

export function generateServer(answers: Answers): string {
  return [
    ...buildImports(answers),
    ``,
    `const dataDir = process.env.DATA_DIR || "./data";`,
    `const port = Number(process.env.PORT) || 3000;`,
    ``,
    ...LOAD_ENV_LINES,
    ...envCheckLines(answers),
    ...buildAdapterLines(answers),
    ``,
    ...buildRouterLines(answers),
    ``,
    `const server = serve({ fetch: app.fetch, port }, () => {`,
    `  app.lifecycle.logger.info({ port }, "StoryShelf server listening");`,
    `});`,
    ``,
    `for (const signal of ["SIGINT", "SIGTERM"] as const) {`,
    `  process.once(signal, () => {`,
    `    app.lifecycle.teardown().finally(() => server.close());`,
    `  });`,
    `}`,
    ``,
  ].join("\n");
}
