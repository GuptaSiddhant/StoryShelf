import type { Preview } from "@storybook/react";

/** Applies the `theme` global to the page so modes produce visibly different captures. */
function applyTheme(theme: unknown): void {
  const dark = theme === "dark";
  document.body.style.background = dark ? "#09090b" : "#ffffff";
  document.body.style.color = dark ? "#fafafa" : "#09090b";
}

const preview: Preview = {
  parameters: {
    controls: { expanded: true },
    layout: "centered",
  },
  initialGlobals: { theme: "light" },
  globalTypes: {
    theme: {
      description: "Color theme",
      toolbar: { title: "Theme", items: ["light", "dark"], dynamicTitle: true },
    },
  },
  decorators: [
    (Story, context) => {
      applyTheme(context.globals["theme"]);
      return Story();
    },
  ],
};

export default preview;
