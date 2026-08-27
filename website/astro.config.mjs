import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://storyshelf.dev",
  integrations: [
    starlight({
      title: "StoryShelf",
      description: "Self-hosted visual testing for Storybook.",
      social: [
        {
          label: "GitHub",
          href: "https://github.com/GuptaSiddhant/storyshelf",
          icon: "github",
        },
      ],
      sidebar: [
        {
          label: "Guides",
          items: [
            { label: "Getting started", slug: "guides/getting-started" },
            { label: "CI setup", slug: "guides/ci" },
            { label: "Deployment", slug: "guides/deployment" },
          ],
        },
        {
          label: "Concepts",
          items: [
            { label: "Baselines & branches", slug: "concepts/baselines" },
            { label: "Labels", slug: "concepts/labels" },
          ],
        },
        {
          label: "Packages",
          items: [
            { label: "@storyshelf/core", href: "https://github.com/GuptaSiddhant/StoryShelf/packages/core/README.md" },
            { label: "@storyshelf/cli", href: "https://github.com/GuptaSiddhant/StoryShelf/packages/cli/README.md" },
            { label: "@storyshelf/db-sqlite", href: "https://github.com/GuptaSiddhant/StoryShelf/packages/db-sqlite/README.md" },
            { label: "@storyshelf/db-turso", href: "https://github.com/GuptaSiddhant/StoryShelf/packages/db-turso/README.md" },
            { label: "@storyshelf/storage-local", href: "https://github.com/GuptaSiddhant/StoryShelf/packages/storage-local/README.md" },
            { label: "@storyshelf/storage-s3", href: "https://github.com/GuptaSiddhant/StoryShelf/packages/storage-s3/README.md" },
            { label: "@storyshelf/auth-oauth", href: "https://github.com/GuptaSiddhant/StoryShelf/packages/auth-oauth/README.md" },
            { label: "@storyshelf/auth-password", href: "https://github.com/GuptaSiddhant/StoryShelf/packages/auth-password/README.md" },
          ],
        },
      ],
    }),
  ],
});
