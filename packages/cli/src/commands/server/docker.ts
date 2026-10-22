/** Playwright base image: its bundled browsers must match the `playwright-core` pin. */
const PLAYWRIGHT_IMAGE = "mcr.microsoft.com/playwright:v1.63.0-noble";

/**
 * Images run the TypeScript sources directly (Node strips types), exactly like
 * `npm start`. Bundling is deliberately avoided: a single-file ESM bundle breaks
 * CommonJS dependencies ("Dynamic require ... is not supported") and the vendored
 * assets `@storyshelf/app` reads from disk next to its own modules.
 */
function imageLines(baseImage: string, entry: string): string[] {
  return [
    `FROM ${baseImage}`,
    "WORKDIR /app",
    "COPY package*.json ./",
    "RUN npm install --omit=dev",
    "COPY src/ ./src/",
    "EXPOSE 3000",
    "ENV PORT=3000",
    "ENV DATA_DIR=/data",
    `CMD ["node", "${entry}"]`,
  ];
}

const DOCKERFILE_LINES = imageLines(PLAYWRIGHT_IMAGE, "src/index.ts");

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

export function generateDockerignore(): string {
  return DOCKERIGNORE_LINES.join("\n");
}

function composeLines(database: string): string[] {
  return [
    ...COMPOSE_BASE_LINES,
    "      # Add your env vars here:",
    "      # - AUTH_PASSWORD=your-password",
    ...(database === "turso" ? COMPOSE_TURSO_LINES : []),
    ...(database === "postgres" ? COMPOSE_POSTGRES_LINES : []),
    ...COMPOSE_VOLUMES_LINES,
    ...(database === "postgres" ? COMPOSE_POSTGRES_VOLUMES_LINES : []),
  ];
}

export function generateComposeYaml(database = "sqlite"): string {
  return composeLines(database).join("\n");
}
