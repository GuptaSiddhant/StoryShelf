import type { Project } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { FC } from "hono/jsx";
import { csrfField } from "../shell/csrf-field.tsx";
import { DocumentLayout } from "../shell/document.tsx";
import { getStore } from "../store.ts";
import { Button, Dialog, FormActions, PageHeader } from "../ui/components.tsx";
import { TAB_LABELS, type SettingsTab } from "./settings-tabs.ts";

/** What a form of a dialog needs: its dialog id, where it posts and the label of its save button. */
export interface DialogFormSpec {
  /** The dialog's id; the form is `<dialog id>-form` and posts into `<dialog id>-body`. */
  dialog: string;
  action: string;
  submitLabel: string;
  /** Posting from a plain page (no dialog): the form carries its own buttons. */
  standalone?: boolean;
  /** Back link of the standalone page. */
  backHref?: string;
  children?: unknown;
}

/**
 * A form that opens in a `Dialog` or stands on a page of its own (ADR 0012, decision 10). It keeps
 * the CSRF field and `hx-post`; in a dialog the save button lives in the dialog footer (`form`
 * attribute), on a page it follows the fields. A refusal (400/409/422) re-renders into the body.
 */
export const DialogForm: FC<DialogFormSpec> = ({
  dialog,
  action,
  submitLabel,
  standalone,
  backHref,
  children,
}) => {
  return (
    <form
      id={`${dialog}-form`}
      method="post"
      action={action}
      hx-post={action}
      hx-target={standalone ? "body" : `#${dialog}-body`}
    >
      {csrfField()}
      {children}
      {standalone ? (
        <FormActions>
          <Button variant="primary" type="submit">
            {submitLabel}
          </Button>
          {backHref ? (
            <Button variant="secondary" href={backHref}>
              Cancel
            </Button>
          ) : null}
        </FormActions>
      ) : null}
    </form>
  );
};

/** An empty dialog for `DialogLink` to fill, with its Cancel and save buttons in the footer. */
export const FormDialog: FC<{ id: string; title: string; submitLabel: string }> = ({
  id,
  title,
  submitLabel,
}) => {
  return (
    <Dialog
      id={id}
      title={title}
      footer={
        <>
          <Button variant="secondary" type="button" data-dialog-close>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`${id}-form`}>
            {submitLabel}
          </Button>
        </>
      }
    />
  );
};

/** The page a form has without JavaScript or from a pasted link: header, the form, a Back link. */
export function renderFormPage(
  project: Project,
  tab: SettingsTab,
  title: string,
  form: unknown,
): unknown {
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  return (
    <DocumentLayout
      title={`${title} · ${project.name}`}
      nav={{
        active: "settings",
        projectSlug: project.slug,
        projectName: project.name,
        trail: [
          { label: TAB_LABELS[tab], href: urls.settingsTab(project.slug, tab) },
          { label: title },
        ],
      }}
    >
      <PageHeader title={title} />
      <div class="max-w-form">{form}</div>
    </DocumentLayout>
  );
}
