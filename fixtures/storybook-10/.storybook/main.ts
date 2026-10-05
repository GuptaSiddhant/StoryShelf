import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(js|jsx|ts|tsx)"],
  addons: [],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  staticDirs: [],
  features: {
    backgrounds: true,
    controls: true,
    viewport: true,
    experimentalTestSyntax: true,
  },
};

export default config;
