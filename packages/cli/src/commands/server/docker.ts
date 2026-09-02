const DOCKERFILE_LINES = [
  "FROM node:lts-alpine AS builder",
  "WORKDIR /app",
  "COPY package.json ./",
  "RUN npm install",
  "COPY server.ts ./",
  "RUN npx esbuild server.ts --bundle --platform=node --format=esm \\",
  "  --external:better-sqlite3 --external:playwright \\",
  "  --outfile=dist/server.mjs",
  "",
  "FROM mcr.microsoft.com/playwright:latest",
  "WORKDIR /app",
  "COPY --from=builder /app/dist/server.mjs ./",
  "COPY --from=builder /app/node_modules/better-sqlite3 \\",
  "  ./node_modules/better-sqlite3/",
  "COPY --from=builder /app/node_modules/playwright \\",
  "  ./node_modules/playwright/",
  "EXPOSE 3000",
  "ENV PORT=3000",
  "ENV DATA_DIR=/data",
  'CMD ["node", "dist/server.mjs"]',
];

const DOCKERIGNORE_LINES = [
  "node_modules/",
  ".git/",
  "*.md",
  ".env*",
  "data/",
];

const COMPOSE_LINES = [
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
  "      # Add your env vars here:",
  "      # - AUTH_PASSWORD=your-password",
  "      # - TURSO_DATABASE_URL=libsql://...",
  "      # - TURSO_AUTH_TOKEN=...",
  "volumes:",
  "  storyshelf-data:",
];

export function generateDockerfile(): string {
  return DOCKERFILE_LINES.join("\n");
}

export function generateDockerignore(): string {
  return DOCKERIGNORE_LINES.join("\n");
}

export function generateComposeYaml(): string {
  return COMPOSE_LINES.join("\n");
}
