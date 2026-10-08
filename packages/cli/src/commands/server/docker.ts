/** Playwright base image: its bundled browsers must match the `playwright-core` pin. */
const PLAYWRIGHT_IMAGE = "mcr.microsoft.com/playwright:v1.63.0-noble";

const DOCKERFILE_LINES = [
  "FROM node:lts-alpine AS builder",
  "WORKDIR /app",
  "COPY package.json ./",
  "RUN npm install",
  "COPY src/ ./src/",
  "RUN npx -y esbuild src/index.ts --bundle --platform=node --format=esm \\",
  "  --external:playwright-core \\",
  "  --outfile=dist/server.mjs",
  "",
  `FROM ${PLAYWRIGHT_IMAGE}`,
  "WORKDIR /app",
  "COPY --from=builder /app/dist/server.mjs ./",
  "COPY --from=builder /app/node_modules/playwright-core ./node_modules/playwright-core",
  "EXPOSE 3000",
  "ENV PORT=3000",
  "ENV DATA_DIR=/data",
  'CMD ["node", "server.mjs"]',
];

/** Server image without a browser: the capture worker runs in its own image. */
const SLIM_DOCKERFILE_LINES = [
  "FROM node:lts-alpine",
  "WORKDIR /app",
  "COPY package.json ./",
  "RUN npm install --omit=dev",
  "COPY src/ ./src/",
  "RUN npx -y esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/server.mjs",
  "EXPOSE 3000",
  'CMD ["node", "dist/server.mjs"]',
];

const DOCKERIGNORE_LINES = ["node_modules/", ".git/", "*.md", ".env*", "data/"];

const COMPOSE_BASE_LINES = [
  "services:",
  "  storyshelf:",
  "    build: .",
  "    ports:",
  '      - "3000:3000"',
  "    volumes:",
  "      - storyshelf-data:/data",
  "    environment:",
  "      - SECRET=change-me",
  "      - PORT=3000",
  "      - DATA_DIR=/data",
];

const COMPOSE_TURSO_LINES = [
  "      # - TURSO_DATABASE_URL=libsql://...",
  "      # - TURSO_AUTH_TOKEN=...",
];

const COMPOSE_POSTGRES_LINES = [
  "      - DATABASE_URL=postgres://shelf:shelf@postgres:5432/shelf",
  "    depends_on:",
  "      postgres:",
  "        condition: service_healthy",
  "  postgres:",
  "    image: postgres:16-alpine",
  "    environment:",
  "      - POSTGRES_DB=shelf",
  "      - POSTGRES_USER=shelf",
  "      - POSTGRES_PASSWORD=shelf",
  "    volumes:",
  "      - postgres-data:/var/lib/postgresql/data",
  "    healthcheck:",
  '      test: ["CMD-SHELL", "pg_isready -U shelf -d shelf"]',
  "      interval: 5s",
  "      timeout: 5s",
  "      retries: 5",
];

const COMPOSE_VOLUMES_LINES = ["volumes:", "  storyshelf-data:"];

const COMPOSE_POSTGRES_VOLUMES_LINES = ["  postgres-data:"];

export function generateDockerfile(): string {
  return DOCKERFILE_LINES.join("\n");
}

export function generateSlimServerDockerfile(): string {
  return SLIM_DOCKERFILE_LINES.join("\n");
}

export function generateDockerignore(): string {
  return DOCKERIGNORE_LINES.join("\n");
}

function composeLines(database: string, withWorker: boolean): string[] {
  return [
    ...COMPOSE_BASE_LINES,
    "      # Add your env vars here:",
    "      # - AUTH_PASSWORD=your-password",
    ...(database === "turso" ? COMPOSE_TURSO_LINES : []),
    ...(database === "postgres" ? COMPOSE_POSTGRES_LINES : []),
    // Services must precede the top-level `volumes:` block.
    ...(withWorker ? workerComposeLines(database) : []),
    ...COMPOSE_VOLUMES_LINES,
    ...(database === "postgres" ? COMPOSE_POSTGRES_VOLUMES_LINES : []),
  ];
}

export function generateComposeYaml(database = "sqlite"): string {
  return composeLines(database, false).join("\n");
}

const WORKER_DOCKERFILE_LINES = [
  "FROM node:lts-alpine AS builder",
  "WORKDIR /app",
  "COPY package.json ./",
  "RUN npm install",
  "COPY src/ ./src/",
  "RUN npx -y esbuild src/worker.ts --bundle --platform=node --format=esm \\",
  "  --external:playwright-core \\",
  "  --outfile=dist/worker.mjs",
  "",
  `FROM ${PLAYWRIGHT_IMAGE}`,
  "WORKDIR /app",
  "COPY --from=builder /app/dist/worker.mjs ./",
  "COPY --from=builder /app/node_modules/playwright-core ./node_modules/playwright-core",
  "ENV DATA_DIR=/data",
  'CMD ["node", "worker.mjs"]',
];

function workerComposeLines(database: string): string[] {
  const postgres = database === "postgres";
  return [
    "  worker:",
    "    build:",
    "      dockerfile: Dockerfile.worker",
    "    volumes:",
    "      - storyshelf-data:/data",
    "    environment:",
    "      - SECRET=change-me",
    "      - DATA_DIR=/data",
    ...(postgres ? ["      - DATABASE_URL=postgres://shelf:shelf@postgres:5432/shelf"] : []),
    // oxlint-disable-next-line no-template-curly-in-string -- literal compose interpolation
    "      - QUEUE_URL=${QUEUE_URL}",
    "      - WORKER_CONCURRENCY=2",
    "    depends_on:",
    "      storyshelf:",
    "        condition: service_started",
    ...(postgres ? ["      postgres:", "        condition: service_healthy"] : []),
  ];
}

export function generateWorkerDockerfile(): string {
  return WORKER_DOCKERFILE_LINES.join("\n");
}

export function generateWorkerComposeSnippet(database = "sqlite"): string {
  return workerComposeLines(database).join("\n");
}

export function generateComposeYamlWithWorker(database = "sqlite"): string {
  return composeLines(database, true).join("\n");
}
