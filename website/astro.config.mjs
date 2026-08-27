import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://storyshelf.dev",
  integrations: [
    starlight({
      title: "StoryShelf",
      description: "Self-hosted visual testing for Storybook.",
      social: {
        github: "https://github.com/GuptaSiddhant/storyshelf",
      },
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
      ],
    }),
  ],
});
