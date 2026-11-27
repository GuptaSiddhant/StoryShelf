import type { FC } from "hono/jsx";
import { Card, PageHeader } from "../ui/components.tsx";
import { DocumentLayout, type NavConfig } from "./document.tsx";

/**
 * The one frame of a form that stands on a page of its own: a 640 px column, the title and one
 * line of description above, the fields in a `Card`. A page passes its content and never picks
 * the width, so every form page reads the same (#1286 L2). Put the submit button, then "Cancel",
 * at the end of the children.
 */
export const FormPage: FC<{
  title: string;
  /** The `<title>` of the tab, when it differs from the heading. */
  tabTitle?: string;
  description?: string;
  nav: NavConfig;
  /** A notice above the card, such as a refused post. */
  notice?: unknown;
  children?: unknown;
}> = ({ title, tabTitle, description, nav, notice, children }) => (
  <DocumentLayout layout="form-page" title={tabTitle ?? title} nav={nav}>
    <PageHeader title={title} description={description} />
    {notice}
    <Card>{children}</Card>
  </DocumentLayout>
);
