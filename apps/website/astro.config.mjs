import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://storyshelf.js.org",
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
            { label: "Live Demo", slug: "guides/demo" },
            {
              label: "Workflow",
              collapsed: true,
              items: [
                { label: "CI setup", slug: "guides/ci" },
                { label: "Interaction testing", slug: "guides/interaction-testing" },
                { label: "Review workflow", slug: "guides/review" },
              ],
            },
            {
              label: "Deployment",
              collapsed: false,
              items: [
                { label: "Overview", slug: "guides/deployment" },
                { label: "Docker Compose", slug: "guides/deployment/docker-compose" },
                { label: "AWS", slug: "guides/deployment/aws" },
                { label: "Azure", slug: "guides/deployment/azure" },
                { label: "GCP", slug: "guides/deployment/gcp" },
                { label: "Cloud assembly", slug: "guides/deployment/cloud" },
              ],
            },
            { label: "Project settings", slug: "guides/project-settings" },
            {
              label: "API",
              collapsed: true,
              items: [
                { label: "REST API", slug: "guides/api" },
                { label: "OpenAPI", link: "/openapi/" },
                { label: "Webhooks", slug: "guides/webhooks" },
              ],
            },
            {
              label: "Chromatic",
              collapsed: true,
              items: [
                { label: "Comparison", slug: "guides/chromatic-comparison" },
                { label: "Migration", slug: "guides/chromatic-migration" },
              ],
            },
            {
              label: "CLI",
              collapsed: true,
              items: [
                { label: "Overview", slug: "guides/cli" },
                { label: "Client", slug: "guides/cli/client" },
                { label: "Server", slug: "guides/cli/server" },
                { label: "Configuration", slug: "guides/config" },
              ],
            },
            {
              label: "Security",
              collapsed: true,
              items: [{ label: "Auth", slug: "guides/auth" }],
            },
          ],
        },
        {
          label: "Core Concepts",
          collapsed: true,
          items: [
            { label: "Projects", slug: "concepts/projects" },
            { label: "Builds & snapshots", slug: "concepts/builds" },
            { label: "Capture & viewports", slug: "concepts/capture" },
            { label: "Affected capture", slug: "concepts/affected-capture" },
            { label: "Baselines & branches", slug: "concepts/baselines" },
            { label: "Labels", slug: "concepts/labels" },
            { label: "Retention & purge", slug: "concepts/retention" },
            { label: "Published Storybook", slug: "concepts/publishing" },
            { label: "Roles & tokens", slug: "concepts/roles" },
          ],
        },
        {
          label: "Packages",
          collapsed: true,
          items: [
            { label: "@storyshelf/core", slug: "packages/core" },
            { label: "@storyshelf/affected", slug: "packages/affected" },
            { label: "@storyshelf/app", slug: "packages/app" },
            { label: "storyshelf", slug: "packages/cli" },
            { label: "@storyshelf/runner-playwright", slug: "packages/runner-playwright" },
            { label: "@storyshelf/runner-puppeteer", slug: "packages/runner-puppeteer" },
            { label: "@storyshelf/db-postgres", slug: "packages/db-postgres" },
            { label: "@storyshelf/db-sqlite", slug: "packages/db-sqlite" },
            { label: "@storyshelf/db-turso", slug: "packages/db-turso" },
            { label: "@storyshelf/storage-local", slug: "packages/storage-local" },
            { label: "@storyshelf/storage-s3", slug: "packages/storage-s3" },
            { label: "@storyshelf/storage-azure", slug: "packages/storage-azure" },
            { label: "@storyshelf/storage-gcs", slug: "packages/storage-gcs" },
            { label: "@storyshelf/auth-oauth", slug: "packages/auth-oauth" },
            { label: "@storyshelf/auth-password", slug: "packages/auth-password" },
            { label: "@storyshelf/git-github", slug: "packages/git-github" },
            { label: "@storyshelf/git-gitlab", slug: "packages/git-gitlab" },
            { label: "@storyshelf/queue-sqs", slug: "packages/queue-sqs" },
            { label: "@storyshelf/queue-redis", slug: "packages/queue-redis" },
            { label: "@storyshelf/queue-azure", slug: "packages/queue-azure" },
            { label: "@storyshelf/worker", slug: "packages/worker" },
          ],
        },
      ],
    }),
  ],
});
