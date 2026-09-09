const DOCKERFILE_LINES = [
  "FROM node:lts-alpine AS builder",
  "WORKDIR /app",
  "COPY package.json ./",
  "RUN npm install",
  "COPY server.ts ./",
  "RUN npx esbuild server.ts --bundle --platform=node --format=esm \\",
  "  --external:playwright \\",
  "  --outfile=dist/server.mjs",
  "",
  "FROM mcr.microsoft.com/playwright:latest",
  "WORKDIR /app",
  "COPY --from=builder /app/dist/server.mjs ./",
  "COPY --from=builder /app/node_modules/playwright \\",
  "  ./node_modules/playwright/",
  "EXPOSE 3000",
  "ENV PORT=3000",
  "ENV DATA_DIR=/data",
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

export function generateDockerignore(): string {
  return DOCKERIGNORE_LINES.join("\n");
}

export function generateComposeYaml(database = "sqlite"): string {
  const lines = [
    ...COMPOSE_BASE_LINES,
    "      # Add your env vars here:",
    "      # - AUTH_PASSWORD=your-password",
    ...(database === "postgres" ? [] : COMPOSE_TURSO_LINES),
    ...(database === "postgres" ? COMPOSE_POSTGRES_LINES : []),
    ...COMPOSE_VOLUMES_LINES,
    ...(database === "postgres" ? COMPOSE_POSTGRES_VOLUMES_LINES : []),
  ];

  return lines.join("\n");
}
