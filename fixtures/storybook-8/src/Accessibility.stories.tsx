import type { Meta, StoryObj } from "@storybook/react";

// Accessibility fixtures for the axe-core checks (ADR 0004 §6). Inline data-URI image: no network.
const PIXEL =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Crect width='24' height='24' fill='%232b7fff'/%3E%3C/svg%3E";

function MissingAltMarkup() {
  return (
    <div>
      <img src={PIXEL} width={24} height={24} />
      <button type="button" />
    </div>
  );
}

const meta: Meta<typeof MissingAltMarkup> = {
  title: "Components/Accessibility",
  component: MissingAltMarkup,
};

export default meta;

type Story = StoryObj<typeof MissingAltMarkup>;

// Known violations: image-alt (critical) and button-name (critical)
export const MissingAlt: Story = {
  render: () => <MissingAltMarkup />,
};

// Known violation: color-contrast (light grey on white)
export const LowContrast: Story = {
  render: () => (
    <p style={{ color: "#bbbbbb", background: "#ffffff", fontFamily: "system-ui" }}>
      Low contrast text
    </p>
  ),
};

// No violations
export const Clean: Story = {
  render: () => (
    <div>
      <img src={PIXEL} width={24} height={24} alt="Blue square" />
      <button type="button">Save</button>
    </div>
  ),
};

// Same markup as MissingAlt, but the story opts out of axe
export const DisabledA11y: Story = {
  parameters: { a11y: { disable: true } },
  render: () => <MissingAltMarkup />,
};

// image-alt switched off through `parameters.a11y.config.rules`; button-name still reported
export const RuleOverride: Story = {
  parameters: { a11y: { config: { rules: [{ id: "image-alt", enabled: false }] } } },
  render: () => <MissingAltMarkup />,
};

// Known best-practice violation: heading-order (h1 followed by h4). The default run set includes
// axe's `best-practice` rules; the page-level ones (region, landmark-one-main) stay silent for an
// isolated story because only the story root is scanned.
export const BestPractice: Story = {
  render: () => (
    <div>
      <h1>Title</h1>
      <h4>Skipped heading levels</h4>
    </div>
  ),
};
