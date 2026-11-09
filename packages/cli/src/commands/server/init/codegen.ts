import { DB_IMPORT, DB_INIT, dbPrelude, STORAGE_IMPORT, STORAGE_INIT } from "./adapter-snippets.ts";
import {
  resolveDeployTarget,
  wantsDesign,
  wantsGit,
  wantsNotifications,
  wantsObservability,
  type Answers,
} from "./answers.ts";

/** The provider lists the generated `notifications.notifiers` spreads, in wiring order. */
function notifierSpreads(answers: Answers): string[] {
  return [
    ...(wantsNotifications(answers) ? ["...chatNotifiers", "...emailNotifiers"] : []),
    ...(wantsGit(answers) ? ["...gitNotifiers"] : []),
  ];
}

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
    ...(wantsGit(answers) ? [`import { gitNotifiers } from "@storyshelf/notify-git";`] : []),
    ...(wantsDesign(answers) ? [DESIGN_IMPORT] : []),
    ...(wantsNotifications(answers) ? notificationImports(answers) : []),
  ]);
}

const OBSERVABILITY_IMPORTS = [
  `import { createShelfLogger } from "@storyshelf/core/logger";`,
  `import { otelLogMixin } from "@storyshelf/observability";`,
  `import { initObservabilityFromEnv } from "@storyshelf/observability/node";`,
];

const DESIGN_IMPORT = `import { createFigmaDesign, figmaOAuthFromEnv } from "@storyshelf/design-figma";`;

/** The auth imports: the password admin, or the OAuth preset of the deploy target (Cognito on AWS). */
function authImports(answers: Answers): string[] {
  if (answers.auth === "password") {
    return [`import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";`];
  }
  if (answers.auth === "oauth") {
    const preset = resolveDeployTarget(answers) === "aws" ? "cognitoPreset" : "keycloakPreset";
    return [
      `import { createShelfAuth } from "@storyshelf/auth";`,
      `import { ${preset} } from "@storyshelf/auth";`,
    ];
  }
  return [];
}

function notificationImports(answers: Answers): string[] {
  return [
    `import { chatNotifiers } from "@storyshelf/notify-chat";`,
    `import { createEmailNotifier, smtpPresetFromEnv } from "@storyshelf/notify-email";`,
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
  `const emailSender = smtpPresetFromEnv(process.env);`,
  `const emailNotifiers = emailSender`,
  `  ? [createEmailNotifier(emailSender, { from: process.env.SMTP_FROM })]`,
  `  : [];`,
];

function buildRouterLines(answers: Answers): string[] {
  const notifiers = notifierSpreads(answers);
  return [
    ...(wantsObservability(answers) ? OBSERVABILITY_SETUP_LINES : []),
    `const app = createShelfApp({`,
    `  database,`,
    `  storage,`,
    `  testing: { runner: captureRunner },`,
    ...(notifiers.length > 0 ? [`  notifications: { notifiers: [${notifiers.join(", ")}] },`] : []),
    ...authLines(answers),
    ...(wantsDesign(answers)
      ? [`  design: [createFigmaDesign({ oauth: figmaOAuthFromEnv() })],`]
      : []),
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

const COGNITO_SOCIAL_LINES = [
  `    social: [`,
  `      cognitoPreset({`,
  `        domain: process.env.COGNITO_DOMAIN!,`,
  `        region: process.env.COGNITO_REGION!,`,
  `        userPoolId: process.env.COGNITO_USER_POOL_ID!,`,
  `        clientId: process.env.OIDC_CLIENT_ID!,`,
  `        clientSecret: process.env.OIDC_CLIENT_SECRET,`,
  `      }),`,
  `    ],`,
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
  const provider =
    answers.auth === "password"
      ? []
      : resolveDeployTarget(answers) === "aws"
        ? COGNITO_SOCIAL_LINES
        : KEYCLOAK_OAUTH_LINES;
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

export function generateServer(answers: Answers): string {
  return [
    ...buildImports(answers),
    ``,
    `const dataDir = process.env.DATA_DIR || "./data";`,
    `const port = Number(process.env.PORT) || 3000;`,
    ``,
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
