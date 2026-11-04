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
  const imports = [
    `import { serve } from "@hono/node-server";`,
    `import { createShelfApp } from "@storyshelf/app";`,
    DB_IMPORT[answers.database],
    STORAGE_IMPORT[answers.storage],
    `import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";`,
  ];
  if (wantsObservability(answers)) {
    imports.push(
      `import { createShelfLogger } from "@storyshelf/core/logger";`,
      `import { otelLogMixin } from "@storyshelf/observability";`,
      `import { initObservabilityFromEnv } from "@storyshelf/observability/node";`,
    );
  }

  if (answers.auth === "password") {
    imports.push(`import { createShelfAuth, ensurePasswordAdmin } from "@storyshelf/auth";`);
  }
  if (answers.auth === "oauth") {
    imports.push(`import { createShelfAuth } from "@storyshelf/auth";`);
    if (resolveDeployTarget(answers) === "aws") {
      imports.push(`import { cognitoPreset } from "@storyshelf/auth";`);
    } else {
      imports.push(`import { keycloakPreset } from "@storyshelf/auth";`);
    }
  }
  if (wantsGit(answers)) {
    imports.push(`import { gitNotifiers } from "@storyshelf/notify-git";`);
  }
  if (wantsDesign(answers)) {
    imports.push(
      `import { createFigmaDesign, figmaOAuthFromEnv } from "@storyshelf/design-figma";`,
    );
  }
  if (wantsNotifications(answers)) {
    imports.push(
      `import { chatNotifiers } from "@storyshelf/notify-chat";`,
      `import { createEmailNotifier, smtpPresetFromEnv } from "@storyshelf/notify-email";`,
    );
    if (answers.auth !== "none") {
      imports.push(`import { createAuthSystemHook } from "@storyshelf/app";`);
    }
  }
  return mergeImports(imports);
}

function buildAdapterLines(answers: Answers): string[] {
  const lines = [
    ...dbPrelude(answers.database),
    `const database = ${DB_INIT[answers.database]};`,
    `const storage = ${STORAGE_INIT[answers.storage]};`,
    `const captureRunner = createPlaywrightCaptureRunner();`,
  ];
  if (wantsNotifications(answers)) {
    lines.push(
      `// SMTP sender from SMTP_* env (undefined keeps invites out-of-band).`,
      `const emailSender = smtpPresetFromEnv(process.env);`,
      `const emailNotifiers = emailSender`,
      `  ? [createEmailNotifier(emailSender, { from: process.env.SMTP_FROM })]`,
      `  : [];`,
    );
  }
  return lines;
}

function buildRouterLines(answers: Answers): string[] {
  const lines = wantsObservability(answers)
    ? [
        `// Noop unless OTEL_EXPORTER_OTLP_ENDPOINT is set.`,
        `const observability = await initObservabilityFromEnv();`,
        `const shelfLogger = createShelfLogger({ mixin: otelLogMixin });`,
        ``,
      ]
    : [];
  lines.push(
    `const app = createShelfApp({`,
    `  database,`,
    `  storage,`,
    `  testing: { runner: captureRunner },`,
  );

  const notifiers = notifierSpreads(answers);
  if (notifiers.length > 0) {
    lines.push(`  notifications: { notifiers: [${notifiers.join(", ")}] },`);
  }

  if (answers.auth === "password") {
    lines.push(
      `  auth: createShelfAuth({`,
      `    db: database,`,
      `    secret: process.env.SECRET!,`,
      `    baseURL: process.env.PUBLIC_BASE_URL!,`,
      ...(wantsNotifications(answers)
        ? [
            `    emailSender,`,
            `    fromEmail: process.env.SMTP_FROM,`,
            `    onAuthSystemEvent: createAuthSystemHook(),`,
          ]
        : []),
      `  }).adapter,`,
    );
  }
  if (answers.auth === "oauth" && resolveDeployTarget(answers) === "aws") {
    lines.push(
      `  auth: createShelfAuth({`,
      `    db: database,`,
      `    secret: process.env.SECRET!,`,
      `    baseURL: process.env.PUBLIC_BASE_URL!,`,
      ...(wantsNotifications(answers)
        ? [
            `    emailSender,`,
            `    fromEmail: process.env.SMTP_FROM,`,
            `    onAuthSystemEvent: createAuthSystemHook(),`,
          ]
        : []),
      `    social: [`,
      `      cognitoPreset({`,
      `        domain: process.env.COGNITO_DOMAIN!,`,
      `        region: process.env.COGNITO_REGION!,`,
      `        userPoolId: process.env.COGNITO_USER_POOL_ID!,`,
      `        clientId: process.env.OIDC_CLIENT_ID!,`,
      `        clientSecret: process.env.OIDC_CLIENT_SECRET,`,
      `      }),`,
      `    ],`,
      `  }).adapter,`,
    );
  }
  if (answers.auth === "oauth" && resolveDeployTarget(answers) !== "aws") {
    lines.push(
      `  auth: createShelfAuth({`,
      `    db: database,`,
      `    secret: process.env.SECRET!,`,
      `    baseURL: process.env.PUBLIC_BASE_URL!,`,
      ...(wantsNotifications(answers)
        ? [
            `    emailSender,`,
            `    fromEmail: process.env.SMTP_FROM,`,
            `    onAuthSystemEvent: createAuthSystemHook(),`,
          ]
        : []),
      `    oauth: [`,
      `      keycloakPreset(process.env.OIDC_ISSUER!, {`,
      `        clientId: process.env.OIDC_CLIENT_ID!,`,
      `        clientSecret: process.env.OIDC_CLIENT_SECRET,`,
      `      }),`,
      `    ],`,
      `  }).adapter,`,
    );
  }
  if (wantsDesign(answers)) {
    lines.push(`  design: [createFigmaDesign({ oauth: figmaOAuthFromEnv() })],`);
  }

  if (wantsObservability(answers)) {
    lines.push(`  logger: shelfLogger,`, `  observability,`);
  }
  lines.push(
    `  config: {`,
    `    secret: process.env.SECRET,`,
    `    previousSecret: process.env.SECRET_PREVIOUS || undefined,`,
    `    migrateCredentialsOnBoot: process.env.SECRET_MIGRATE === "true",`,
    `    scratchDir: dataDir,`,
    `  },`,
    `});`,
    ``,
    `await app.lifecycle.setup();`,
  );

  if (answers.auth === "password") {
    lines.push(
      ``,
      `// Provision the env-driven local admin (AUTH_PASSWORD, at least 12 chars).`,
      `await ensurePasswordAdmin(database, {`,
      `  email: process.env.AUTH_EMAIL ?? "admin@example.com",`,
      `  password: process.env.AUTH_PASSWORD!,`,
      `});`,
    );
  }

  return lines;
}

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
