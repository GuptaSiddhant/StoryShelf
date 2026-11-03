import type { Preview } from "@storybook/html-vite";
import { baseStyle } from "../src/ui/styles.ts";
import { DARK_THEME, LIGHT_THEME } from "../src/ui/theme.ts";
import { iconSprite } from "./shims/sprite.ts";

/** The app's global stylesheet and icon sprite, mounted once like `DocumentLayout` does. */
function mountGlobals(): void {
  const { document } = globalThis;
  if (document.querySelector("#storyshelf-base")) return;
  const style = document.createElement("style");
  style.id = "storyshelf-base";
  style.textContent = baseStyle(LIGHT_THEME, DARK_THEME);
  document.head.append(style);
  document.body.insertAdjacentHTML("afterbegin", iconSprite);
}

mountGlobals();

const preview: Preview = {
  initialGlobals: { theme: "light" },
  globalTypes: {
    theme: {
      description: "Colour theme (the app's own light and dark tokens)",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (story, context) => {
      globalThis.document.documentElement.dataset["theme"] = String(
        context.globals["theme"] ?? "light",
      );
      return story();
    },
  ],
  parameters: {
    layout: "padded",
    controls: { disable: true },
    viewport: {
      options: {
        phone: { name: "Phone 375", styles: { width: "375px", height: "800px" } },
        tablet: { name: "Tablet 768", styles: { width: "768px", height: "1024px" } },
        desktop: { name: "Desktop 1280", styles: { width: "1280px", height: "900px" } },
      },
    },
  },
};

export default preview;
