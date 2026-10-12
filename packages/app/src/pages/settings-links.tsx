import type { Project } from "@storyshelf/core/schema";
import type { HtmlEscapedString } from "hono/utils/html";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  FormActions,
  Meta,
  SectionTitle,
  SelectField,
  Table,
} from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";

/* eslint-disable promise-function-async -- Hono JSX components return HtmlEscapedString | Promise<HtmlEscapedString> */

/** A package linked to the upstream project that publishes it. */
export interface SettingsLink {
  packageName: string;
  upstreamSlug: string;
  upstreamName: string;
}

/** Another project that can be chosen as an upstream. */
export interface SettingsLinkCandidate {
  slug: string;
  name: string;
}

const linkRow = (
  base: string,
  link: SettingsLink,
  isAdmin: boolean,
): HtmlEscapedString | Promise<HtmlEscapedString> => (
  <tr key={link.packageName}>
    <td>
      <Badge tone="neutral">{link.packageName}</Badge>
    </td>
    <td>{link.upstreamName}</td>
    <td>
      {isAdmin ? (
        <form
          method="post"
          action={`${base}/delete`}
          hx-post={`${base}/delete`}
          hx-target="body"
          hx-confirm="Remove this link?"
        >
          {csrfField()}
          <input type="hidden" name="package" value={link.packageName} />
          <Button variant="ghost" type="submit" aria-label={`Remove ${link.packageName}`}>
            Remove
          </Button>
        </form>
      ) : null}
    </td>
  </tr>
);

/** Links settings tab: linked packages plus the add-link form. */
export function renderSettingsLinks(
  project: Project,
  links: SettingsLink[],
  candidates: SettingsLinkCandidate[],
  isAdmin: boolean,
  formState?: { globalError?: string },
): unknown {
  const base = `/projects/${project.slug}/settings/links`;
  return (
    <div class="grid max-w-form">
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <Card>
        <SectionTitle>Linked packages</SectionTitle>
        <Meta>
          Link a package this project consumes (e.g. @acme/design-system) to the project that
          publishes it. Review pages then show where a story uses it, with links to the upstream
          component.
        </Meta>
        <Table>
          <table>
            <thead>
              <tr>
                <th>Package</th>
                <th>Upstream project</th>
                <th>
                  <span class="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>{links.map((link) => linkRow(base, link, isAdmin))}</tbody>
          </table>
        </Table>
        {links.length === 0 ? <Meta>No packages linked.</Meta> : null}
      </Card>
      {isAdmin ? <AddLinkCard base={base} candidates={candidates} /> : null}
    </div>
  );
}

/** Form card linking a package to an upstream project. */
function AddLinkCard(props: {
  base: string;
  candidates: SettingsLinkCandidate[];
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { base, candidates } = props;
  return (
    <Card>
      <SectionTitle level={3}>Link a package</SectionTitle>
      <form method="post" action={base} hx-post={base} hx-target="body">
        {csrfField()}
        <div class="grid grid--2">
          <Field label="Package" name="package" required placeholder="@acme/design-system" />
          <SelectField
            label="Upstream project"
            name="upstreamSlug"
            required
            options={candidates.map((candidate) => ({
              value: candidate.slug,
              label: candidate.name,
            }))}
          />
        </div>
        <FormActions>
          <Button variant="primary" type="submit" icon="plus">
            Link package
          </Button>
        </FormActions>
      </form>
    </Card>
  );
}
