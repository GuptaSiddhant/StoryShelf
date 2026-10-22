import { isCaptureTarget, type RunnerTarget } from "@storyshelf/core/adapter/capture-runner";
import { MAX_BROWSERS, parseBrowsers, parseModesAllowlist } from "@storyshelf/core/capture";
import type { Project } from "@storyshelf/core/schema";
import { MAX_STORYBOOK_URL_TTL, MIN_STORYBOOK_URL_TTL } from "@storyshelf/core/utils";
import type { HtmlEscapedString } from "hono/utils/html";
import {
  Alert,
  Button,
  Card,
  CheckField,
  Field,
  FormActions,
  Meta,
  SectionTitle,
  SelectField,
  TextareaField,
} from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";
import { targetChoices, type TargetChoices } from "./target-choices.ts";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** Primary engine select plus one checkbox per additional engine. */
function BrowserFields(props: {
  primary: string;
  extras: string[];
  disabled: boolean;
  targets: TargetChoices;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { primary, extras, disabled, targets } = props;
  return (
    <>
      <SelectField
        label="Primary browser"
        name="browser"
        value={primary}
        disabled={disabled}
        options={targets.choices}
        hint="Used for the published preview and to bootstrap other engines."
      />
      {targets.choices.map((engine) => (
        <CheckField
          key={engine.value}
          label={`Also capture on ${engine.label}`}
          name={`extra_${engine.value}`}
          value={engine.value}
          checked={extras.includes(engine.value) ? true : undefined}
          disabled={disabled}
        />
      ))}
      {targets.unavailable.length > 0 ? (
        <Meta>Not selectable on this server: {targets.unavailable.join("; ")}.</Meta>
      ) : null}
    </>
  );
}

/** One mode name per line; empty runs every declared mode. */
function AllowlistField(props: {
  allowlist: string[];
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  return (
    <TextareaField
      label="Mode allowlist"
      name="modesAllowlist"
      rows={4}
      value={props.allowlist.join("\n")}
      placeholder="dark&#10;mobile"
      hint="One mode name per line. Empty runs every mode declared in your stories' parameters."
    />
  );
}

/** The project's override of the signed Storybook URL lifetime (ADR 0007, decision 5). */
function UrlLifetimeField(props: {
  project: Project;
  disabled: boolean;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { project, disabled } = props;
  return (
    <Field
      label="Signed Storybook URL lifetime (seconds)"
      name="storybookUrlTtlSeconds"
      type="number"
      step="1"
      min={String(MIN_STORYBOOK_URL_TTL)}
      max={String(MAX_STORYBOOK_URL_TTL)}
      value={project.storybookUrlTtlSeconds ? String(project.storybookUrlTtlSeconds) : ""}
      placeholder="Derived from the stories"
      disabled={disabled}
      hint={`How long the URL given to a remote browser that cannot reach this server stays valid (${MIN_STORYBOOK_URL_TTL} to ${MAX_STORYBOOK_URL_TTL}). Empty derives it from the build's size: at least 2 hours, at most 24.`}
    />
  );
}

/** Capture settings tab: engines to capture on and the mode allowlist. */
export function renderSettingsCapture(
  project: Project,
  isAdmin: boolean,
  formState?: { globalError?: string },
  /** What the runner offers; omitted when it publishes no list. */
  offered?: readonly RunnerTarget[],
): unknown {
  const browsers = parseBrowsers(project.browsers) ?? [project.browser ?? "chromium"];
  const [primary = "chromium", ...extras] = browsers;
  const targets = targetChoices(
    offered,
    browsers.filter((entry) => isCaptureTarget(entry)),
  );
  const allowlist = parseModesAllowlist(project.modesAllowlist) ?? [];
  const action = `/projects/${project.slug}/settings/capture`;
  return (
    <div class="grid max-w-form">
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <Card>
        <SectionTitle>Browsers</SectionTitle>
        <Meta>
          Every build is captured on each selected target, one after another, with a baseline per
          target. One approval covers a story and mode on all engines; use{" "}
          <em>Only this browser</em> in the review for an engine-specific decision. Up to{" "}
          {MAX_BROWSERS} targets. A newly added target starts from its first build.
        </Meta>
        <form method="post" action={action} hx-post={action} hx-target="body" hx-swap="outerHTML">
          {csrfField()}
          <BrowserFields primary={primary} extras={extras} disabled={!isAdmin} targets={targets} />
          <AllowlistField allowlist={allowlist} />
          <UrlLifetimeField project={project} disabled={!isAdmin} />
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
