import type { Project } from "@storyshelf/core/schema";
import { createUrlBuilder } from "@storyshelf/core/urls";
import type { FC } from "hono/jsx";
import { csrfField } from "../shell/csrf-field.tsx";
import { FormPage } from "../shell/form-page.tsx";
import { getStore } from "../store.ts";
import { Button, Dialog, FormActions, Form } from "../ui/components.tsx";
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
    <Form
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
    </Form>
  );
};

/** An empty dialog for `DialogLink` to fill, with its Cancel and save buttons in the footer. */
export const FormDialog: FC<{
  id: string;
  title: string;
  submitLabel: string;
  /** Show it open with its form (stories). */
  open?: boolean;
  children?: unknown;
}> = ({ id, title, submitLabel, open, children }) => {
  return (
    <Dialog
      id={id}
      title={title}
      open={open}
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
    >
      {children}
    </Dialog>
  );
};

/** The one frame of a form page: header, then the form in the shared form-page column. */
function formPage(
  title: string,
  nav: Parameters<typeof FormPage>[0]["nav"],
  pageTitle: string,
  form: unknown,
): unknown {
  return (
    <FormPage title={title} tabTitle={pageTitle} nav={nav}>
      {form}
    </FormPage>
  );
}

/** The page a form has without JavaScript or from a pasted link: header, the form, a Back link. */
export function renderFormPage(
  project: Project,
  tab: SettingsTab,
  title: string,
  form: unknown,
): unknown {
  const urls = createUrlBuilder("/", getStore().config.publishedBaseDomain);
  const trail = [
    { label: TAB_LABELS[tab], href: urls.settingsTab(project.slug, tab) },
    { label: title },
  ];
  const nav = {
    active: "settings" as const,
    projectSlug: project.slug,
    projectName: project.name,
    trail,
  };
  return formPage(title, nav, `${title} · ${project.name}`, form);
}

/** The page an admin form has without JavaScript or from a pasted link: System › title. */
export function renderAdminFormPage(title: string, form: unknown): unknown {
  const nav = {
    active: "admin" as const,
    trail: [{ label: "System", href: "/admin" }, { label: title }],
  };
  return formPage(title, nav, `${title} · System`, form);
}
