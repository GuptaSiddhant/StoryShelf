import preview from "../.storybook/preview";

import { Button } from "./Button";

const meta = preview.meta({
  title: "Components/Themed",
  component: Button,
  args: { label: "Themed", variant: "secondary" },
});

// Modes via the `storyshelf` key: captured on desktop plus a light and a dark mode.
export const Surface = meta.story({
  parameters: {
    storyshelf: { modes: { light: { theme: "light" }, dark: { theme: "dark" } } },
  },
});

// Modes via the `chromatic` key (alias): dark theme at a phone width.
export const ChromaticAlias = meta.story({
  parameters: {
    chromatic: { modes: { "dark mobile": { theme: "dark", viewport: "mobile1" } } },
  },
});
