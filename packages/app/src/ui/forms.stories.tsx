// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { jsxStory } from "../../.storybook/render.tsx";
import {
  Button,
  Card,
  CheckField,
  Field,
  Form,
  FormActions,
  SelectField,
  TextareaField,
  VStack,
} from "./components.tsx";

const meta: Meta = { title: "UI/Forms" };
export default meta;

export const NarrowForm = jsxStory(() => (
  <Card>
    <Form narrow>
      <Field label="Display name" name="displayName" value="Siddhant" />
      <FormActions>
        <Button variant="primary" type="submit">
          Save name
        </Button>
      </FormActions>
    </Form>
  </Card>
));

export const FieldStates = jsxStory(() => (
  <VStack>
    <Field label="Project name" name="name" placeholder="Design system" />
    <Field
      label="Default branch"
      name="branch"
      value="main"
      hint="Baselines are kept per branch."
    />
    <Field label="Email" name="email" type="email" required autocomplete="email" />
    <Field
      label="Slug"
      name="slug"
      value="design system"
      error="Use lowercase letters, digits and dashes."
    />
    <Field label="Project ID" name="id" value="01JD0000000000000000000001" disabled />
  </VStack>
));

export const InlineFields = jsxStory(() => (
  <VStack>
    <Field label="Viewport width" name="width" type="number" value="1280" layout="inline" />
    <SelectField
      label="Browser"
      name="browser"
      layout="inline"
      value="chromium"
      options={[
        { value: "chromium", label: "Chromium" },
        { value: "firefox", label: "Firefox" },
        { value: "webkit", label: "WebKit" },
      ]}
    />
  </VStack>
));

export const Textarea = jsxStory(() => (
  <VStack>
    <TextareaField
      label="Add comment"
      name="body"
      rows={3}
      placeholder="Leave feedback on this snapshot…"
    />
    <TextareaField
      label="Notes"
      name="notes"
      rows={3}
      value="Padding looks off on mobile."
      hint="Visible to reviewers."
    />
    <TextareaField label="Reason" name="reason" rows={3} required error="A reason is required." />
  </VStack>
));

/** For patterns or code: the mono face and no spell-check, with content. */
export const TextareaMonospace = jsxStory(() => (
  <TextareaField
    label="Component owners"
    name="owners"
    rows={4}
    monospace
    value={
      "src/components/forms/**  user_01HFORMS  user_02JDESIGN\nsrc/components/charts/**  user_03KCHARTS"
    }
    hint="One rule per line: a glob, then the members who own it."
  />
));

/** The mono face with an empty field and its placeholder. */
export const TextareaMonospaceEmpty = jsxStory(() => (
  <TextareaField
    label="Component owners"
    name="owners"
    rows={3}
    monospace
    placeholder="src/components/forms/**  user_01H  user_02J"
  />
));

/** The mono face in its error state. */
export const TextareaMonospaceError = jsxStory(() => (
  <TextareaField
    label="Component owners"
    name="owners"
    rows={3}
    monospace
    value="src/components/charts/**  user_9Z"
    error="Line 1: user_9Z is not a member of this project."
  />
));

export const Select = jsxStory(() => (
  <VStack>
    <SelectField
      label="Role"
      name="role"
      value="developer"
      hint="Developers can approve builds."
      options={[
        { value: "viewer", label: "Viewer" },
        { value: "developer", label: "Developer" },
        { value: "admin", label: "Admin" },
      ]}
    />
    <SelectField
      label="Locked"
      name="locked"
      disabled
      options={[{ value: "a", label: "Locked option" }]}
    />
  </VStack>
));

export const Checkboxes = jsxStory(() => (
  <VStack>
    <CheckField label="Run accessibility checks" name="a11y" checked />
    <CheckField label="Run Storybook tests" name="tests" hint="Adds a test result to each build." />
    <CheckField label="Notify on failure" name="notify" disabled checked />
  </VStack>
));

export const FormActionAlignment = jsxStory(() => (
  <VStack gap="lg">
    {(["start", "end", "split"] as const).map((align) => (
      <Card key={align}>
        <FormActions align={align}>
          <Button variant="ghost">Cancel</Button>
          <Button>Save</Button>
        </FormActions>
      </Card>
    ))}
  </VStack>
));

/** A form in a card: the fields and the buttons sit one step apart and the card ends under the buttons. */
export const FormInCard = jsxStory(() => (
  <Card>
    <Form method="post" action="/">
      <Field label="Project name" name="name" placeholder="Design system" required />
      <Field
        label="Default branch"
        name="branch"
        value="main"
        hint="Baselines are kept per branch."
      />
      <CheckField label="Run accessibility checks" name="a11y" checked />
      <FormActions>
        <Button>Save</Button>
        <Button variant="ghost">Cancel</Button>
      </FormActions>
    </Form>
  </Card>
));

/** Native controls take the app theme's `color-scheme`; switch the theme toolbar to Dark to check. */
export const NativeControls = jsxStory(() => (
  <VStack>
    <CheckField label="Show skipped" name="skipped" checked />
    <CheckField label="Run Storybook tests" name="tests" />
    <SelectField
      label="Role"
      name="role"
      value="viewer"
      options={[
        { value: "viewer", label: "Viewer" },
        { value: "admin", label: "Admin" },
      ]}
    />
    <input type="range" min="0" max="100" value="40" aria-label="Opacity" />
  </VStack>
));
