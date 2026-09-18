import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://storyshelf.dev",
  base: process.env.BASE_PATH || "/",
  integrations: [
    mermaid({ autoTheme: true }),
    starlight({
      title: "StoryShelf",
      plugins: [],
      description: "Self-hosted visual testing for Storybook.",
      social: [
        {
          label: "GitHub",
          href: "https://github.com/GuptaSiddhant/StoryShelf",
          icon: "github",
        },
      ],
      sidebar: [
        {
          label: "Guides",
          items: [
            { label: "Getting started", slug: "guides/getting-started" },
            { label: "CI setup", slug: "guides/ci" },
            { label: "Interaction testing", slug: "guides/interaction-testing" },
            { label: "REST API", slug: "guides/api" },
            { label: "OpenAPI", link: "/openapi/" },
            { label: "Deployment", slug: "guides/deployment" },
            { label: "CLI", slug: "guides/cli" },
            { label: "Configuration", slug: "guides/config" },
            { label: "Auth", slug: "guides/auth" },
            { label: "Chromatic comparison", slug: "guides/chromatic-comparison" },
            { label: "Chromatic migration", slug: "guides/chromatic-migration" },
          ],
        },
        {
          label: "Concepts",
          items: [
            { label: "Projects", slug: "concepts/projects" },
            { label: "Baselines & branches", slug: "concepts/baselines" },
            { label: "Labels", slug: "concepts/labels" },
          ],
        },
        {
          label: "Packages",
          items: [
            { label: "@storyshelf/core", slug: "packages/core" },
            { label: "@storyshelf/app", slug: "packages/app" },
            { label: "storyshelf", slug: "packages/cli" },
            { label: "@storyshelf/runner-playwright", slug: "packages/runner-playwright" },
            { label: "@storyshelf/db-postgres", slug: "packages/db-postgres" },
            { label: "@storyshelf/db-sqlite", slug: "packages/db-sqlite" },
            { label: "@storyshelf/db-turso", slug: "packages/db-turso" },
            { label: "@storyshelf/storage-local", slug: "packages/storage-local" },
            { label: "@storyshelf/storage-s3", slug: "packages/storage-s3" },
            { label: "@storyshelf/auth-oauth", slug: "packages/auth-oauth" },
            { label: "@storyshelf/auth-password", slug: "packages/auth-password" },
            { label: "@storyshelf/git-github", slug: "packages/git-github" },
            { label: "@storyshelf/git-gitlab", slug: "packages/git-gitlab" },
            { label: "@storyshelf/queue-sqs", slug: "packages/queue-sqs" },
            { label: "@storyshelf/queue-redis", slug: "packages/queue-redis" },
          ],
        },
      ],
    }),
  ],
});
