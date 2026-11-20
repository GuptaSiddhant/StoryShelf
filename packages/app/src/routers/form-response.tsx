import type { Project } from "@storyshelf/core/schema";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { renderFormPage } from "../pages/dialog-form.tsx";
import type { SettingsTab } from "../pages/settings-tabs.ts";
import { isHxRequest } from "./htmx.ts";

/**
 * Answer a form of a dialog (ADR 0012, decision 10): the fragment for an HTMX request (it fills the
 * dialog body), the full page for a plain one (no JavaScript, a pasted link). A refusal keeps its
 * status either way, so the form re-renders where it was.
 */
export function respondWithForm(
  c: Context,
  project: Project,
  tab: SettingsTab,
  title: string,
  form: (standalone: boolean) => unknown,
  status: ContentfulStatusCode = 200,
): Response {
  const hx = isHxRequest(c);
  const body = hx ? form(false) : renderFormPage(project, tab, title, form(true));
  return c.html(body as string, status);
}
