import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";
import { defineConfig } from "astro/config";

const SITE = "https://storyshelf.js.org";
const OG_IMAGE = `${SITE}/og-image.png`;
const OG_ALT = "StoryShelf build review: baseline, current, and diff overlay";

export default defineConfig({
  site: SITE,
  base: process.env.BASE_PATH || "/",
  integrations: [
    mermaid({ autoTheme: true }),
    starlight({
      title: "StoryShelf",
      plugins: [],
      // Starlight emits og:title/description/url/type and the sitemap per page;
      // these add the social image and card type it does not set.
      head: [
        { tag: "meta", attrs: { property: "og:image", content: OG_IMAGE } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { property: "og:image:alt", content: OG_ALT } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:image", content: OG_IMAGE } },
        { tag: "meta", attrs: { name: "twitter:image:alt", content: OG_ALT } },
      ],
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
                { label: "Without git", slug: "guides/without-git" },
                { label: "Interaction testing", slug: "guides/interaction-testing" },
                { label: "Review workflow", slug: "guides/review" },
                { label: "Merge gate", slug: "guides/merge-gate" },
              ],
            },
            {
              label: "Deployment",
              collapsed: false,
              items: [
                { label: "Overview", slug: "guides/deployment" },
                { label: "Docker Compose", slug: "guides/deployment/docker-compose" },
                { label: "Remote workers", slug: "guides/deployment/remote-workers" },
                { label: "AWS", slug: "guides/deployment/aws" },
                { label: "Azure", slug: "guides/deployment/azure" },
                { label: "GCP", slug: "guides/deployment/gcp" },
                { label: "Cloud assembly", slug: "guides/deployment/cloud" },
              ],
            },
            { label: "Project settings", slug: "guides/project-settings" },
            { label: "Observability", slug: "guides/observability" },
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
              label: "Auth",
              collapsed: false,
              items: [
                { label: "Overview", slug: "guides/auth" },
                { label: "Local accounts", slug: "guides/auth/local" },
                { label: "Social login", slug: "guides/auth/social" },
                { label: "OIDC", slug: "guides/auth/oidc" },
                { label: "SAML", slug: "guides/auth/saml" },
                { label: "Passkeys", slug: "guides/auth/passkeys" },
                { label: "Configuration", slug: "guides/auth/configuration" },
              ],
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
            { label: "@storyshelf/storage-local", slug: "packages/storage-local" },
            { label: "@storyshelf/storage-s3", slug: "packages/storage-s3" },
            { label: "@storyshelf/storage-azure", slug: "packages/storage-azure" },
            { label: "@storyshelf/storage-gcs", slug: "packages/storage-gcs" },
            { label: "@storyshelf/auth", slug: "packages/auth" },
            { label: "@storyshelf/git-github", slug: "packages/git-github" },
            { label: "@storyshelf/git-gitlab", slug: "packages/git-gitlab" },
            { label: "@storyshelf/queue-sqs", slug: "packages/queue-sqs" },
            { label: "@storyshelf/queue-redis", slug: "packages/queue-redis" },
            { label: "@storyshelf/queue-azure", slug: "packages/queue-azure" },
            { label: "@storyshelf/queue-gcp", slug: "packages/queue-gcp" },
            { label: "@storyshelf/observability", slug: "packages/observability" },
            { label: "@storyshelf/worker", slug: "packages/worker" },
          ],
        },
      ],
    }),
  ],
});
