import type { Meta, StoryObj } from "@storybook/react";
import { useEffect } from "react";
import { Button } from "./Button";

/**
 * Deliberately leaking stories (ADR 0052, decision 9). Each one leaves something behind in the
 * document that a later story could pick up if the page were reused. A fresh page per story hides
 * every one of them, so their own snapshots and those of every other story must not change.
 * `.leak-tint` is defined in `.storybook/preview-head.html`.
 */
const meta: Meta<typeof Button> = {
  title: "Leaks",
  component: Button,
  args: { label: "Leaky", variant: "primary" },
};

export default meta;

type Story = StoryObj<typeof Button>;

/** Appends a fixed badge to `body`; nothing removes it. */
function addBadge(id: string, text: string, top: number): void {
  if (document.getElementById(id)) return;
  const badge = document.createElement("div");
  badge.id = id;
  badge.textContent = text;
  badge.style.cssText = `position:fixed;left:8px;top:${top}px;font:12px sans-serif;color:#b91c1c`;
  document.body.appendChild(badge);
}

/** A class on `body` that is never removed. */
export const BodyClass: Story = {
  render: (args) => {
    document.body.classList.add("leak-tint");
    return <Button {...args} label="Body class" />;
  },
};

/** A node appended to `body`, outside Storybook's roots, as a modal or tooltip library does. */
export const Portal: Story = {
  render: (args) => {
    useEffect(() => addBadge("leak-portal", "portal", 8), []);
    return <Button {...args} label="Portal" />;
  },
};

/** A style element in `head` that restyles every button and is never removed. */
export const GlobalStyle: Story = {
  render: (args) => {
    useEffect(() => {
      if (document.getElementById("leak-style")) return;
      const style = document.createElement("style");
      style.id = "leak-style";
      style.textContent = "button { border-radius: 0 !important; background: #047857 !important; }";
      document.head.appendChild(style);
    }, []);
    return <Button {...args} label="Global style" />;
  },
};

/** An interval that keeps writing to the DOM after the story is gone. */
export const Timer: Story = {
  render: (args) => {
    useEffect(() => {
      window.setInterval(() => addBadge("leak-timer", "timer", 28), 100);
    }, []);
    return <Button {...args} label="Timer" />;
  },
};

/** A font that finishes loading 200 ms after the render and is then applied to the document. */
export const LateFont: Story = {
  render: (args) => {
    useEffect(() => {
      window.setTimeout(() => {
        const face = new FontFace(
          "LeakLate",
          'local("DejaVu Sans Mono"), local("Liberation Mono"), local("Courier New")',
        );
        void face.load().then(() => {
          document.fonts.add(face);
          document.body.style.fontFamily = "LeakLate, monospace";
        });
      }, 200);
    }, []);
    return <Button {...args} label="Late font" />;
  },
};

/** Writes to web storage; `StorageRead` shows whether it finds the value. */
export const StorageWrite: Story = {
  render: (args) => {
    window.localStorage.setItem("leak", "written");
    window.sessionStorage.setItem("leak", "written");
    return <Button {...args} label="Storage write" />;
  },
};

/** Reads what `StorageWrite` leaves in web storage: the label differs if it ran first. */
export const StorageRead: Story = {
  render: (args) => {
    const seen = window.localStorage.getItem("leak") ?? window.sessionStorage.getItem("leak");
    return <Button {...args} label={seen ? "Storage seen" : "Storage empty"} />;
  },
};

/** A play function that mutates the document and the story's own button. */
export const PlayMutates: Story = {
  render: (args) => <Button {...args} label="Play before" />,
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector("button");
    if (button) button.textContent = "Play after";
    document.documentElement.classList.add("leak-played");
    addBadge("leak-play", "play", 48);
  },
};
