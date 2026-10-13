import { MAX_BROWSERS, parseBrowsers, parseModesAllowlist } from "@storyshelf/core/capture";
import type { Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import {
  Alert,
  Button,
  Card,
  CheckField,
  FormActions,
  Meta,
  SectionTitle,
  SelectField,
  TextareaField,
} from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

const ENGINES = [
  { value: "chromium", label: "Chromium" },
  { value: "firefox", label: "Firefox" },
  { value: "webkit", label: "WebKit (Safari engine)" },
  { value: "chrome", label: "Chrome (Chromium engine)" },
];

/** Primary engine select plus one checkbox per additional engine. */
function BrowserFields(props: {
  primary: string;
  extras: string[];
  disabled: boolean;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { primary, extras, disabled } = props;
  return (
    <>
      <SelectField
        label="Primary browser"
        name="browser"
        value={primary}
        disabled={disabled}
        options={ENGINES}
        hint="Used for the published preview and to bootstrap other engines."
      />
      {ENGINES.map((engine) => (
        <CheckField
          key={engine.value}
          label={`Also capture on ${engine.label}`}
          name={`extra_${engine.value}`}
          value={engine.value}
          checked={extras.includes(engine.value) ? true : undefined}
          disabled={disabled}
        />
      ))}
    </>
  );
}

/** Capture settings tab: engines to capture on and the mode allowlist. */
export function renderSettingsCapture(
  project: Project,
  isAdmin: boolean,
  formState?: { globalError?: string },
): unknown {
  const browsers = parseBrowsers(project.browsers) ?? [project.browser ?? "chromium"];
  const [primary = "chromium", ...extras] = browsers;
  const allowlist = parseModesAllowlist(project.modesAllowlist) ?? [];
  const action = `/projects/${project.slug}/settings/capture`;
  return (
    <div class="grid max-w-form">
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <Card>
        <SectionTitle>Browsers</SectionTitle>
        <Meta>
          Every build is captured on each selected engine, one after another, with a baseline per
          engine. One approval covers a story and mode on all engines; use{" "}
          <em>Only this browser</em> in the review for an engine-specific decision. Up to{" "}
          {MAX_BROWSERS} engines. A newly added engine starts from its first build.
        </Meta>
        <form method="post" action={action} hx-post={action} hx-target="body" hx-swap="outerHTML">
          {csrfField()}
          <BrowserFields primary={primary} extras={extras} disabled={!isAdmin} />
          <TextareaField
            label="Mode allowlist"
            name="modesAllowlist"
            rows={4}
            value={allowlist.join("\n")}
            placeholder="dark&#10;mobile"
            hint="One mode name per line. Empty runs every mode declared in your stories' parameters."
          />
          {isAdmin ? (
            <FormActions>
              <Button variant="primary" type="submit" icon="check">
                Save changes
              </Button>
            </FormActions>
          ) : (
            <Meta>You need admin access to edit settings.</Meta>
          )}
        </form>
      </Card>
    </div>
  );
}
