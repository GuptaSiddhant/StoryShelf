import type { Project } from "@storyshelf/core/schema";
import type { Token } from "@storyshelf/core/schema";
import { csrfField } from "../shell/csrf-field.tsx";
import {
  Alert,
  Button,
  Card,
  CodeBlock,
  DialogLink,
  Meta,
  SectionTitle,
  SummaryList,
  VStack,
  formatAbsolute,
  type SummaryItem,
} from "../ui/components.tsx";
import { FormDialog } from "./dialog-form.tsx";
import { uploadCommand } from "./get-started.tsx";
import { CREATE_TOKEN_DIALOG } from "./token-forms.tsx";

function tokenItems(
  project: Project,
  tokens: Omit<Token, "hash">[],
  isAdmin: boolean,
): SummaryItem[] {
  return tokens.map((token) => {
    const action = `/projects/${project.slug}/settings/tokens/${token.id}/delete`;
    return {
      id: token.id,
      name: token.name,
      details: `Created ${formatAbsolute(token.createdAt, "date")} · Last used ${
        token.lastUsedAt ? formatAbsolute(token.lastUsedAt, "date") : "never"
      }`,
      actions: isAdmin ? (
        <form
          method="post"
          action={action}
          hx-post={action}
          hx-target="body"
          hx-confirm="Delete this token? CI jobs using it will stop working."
        >
          {csrfField()}
          <Button variant="danger-secondary" size="sm" type="submit">
            Revoke
          </Button>
        </form>
      ) : undefined,
    };
  });
}

/** Tokens settings tab: project CLI tokens as a summary; creating one opens a dialog. */
export function renderSettingsTokens(
  project: Project,
  tokens: Omit<Token, "hash">[],
  isAdmin: boolean,
  formState?: { globalError?: string; secret?: string; origin?: string },
): unknown {
  const add = isAdmin ? (
    <DialogLink
      dialogId={CREATE_TOKEN_DIALOG}
      href={`/projects/${project.slug}/settings/tokens/new`}
      variant="primary"
      icon="plus"
    >
      Create token
    </DialogLink>
  ) : undefined;
  return (
    <VStack>
      {formState?.secret ? (
        <Alert tone="success" title="Token created">
          <div id="new-token" tabindex={-1}>
            Copy it now — it is shown once.
            <CodeBlock code={formState.secret} label="Copy token" />
            <Meta>Then upload from CI:</Meta>
            <CodeBlock
              code={uploadCommand({
                slug: project.slug,
                origin: formState.origin,
                token: formState.secret,
              })}
              label="Copy upload command"
            />
          </div>
        </Alert>
      ) : null}
      {formState?.globalError ? <Alert tone="danger">{formState.globalError}</Alert> : null}
      <Card>
        <SectionTitle>API tokens</SectionTitle>
        <Meta>Tokens are used by the CLI to upload builds. They are scoped to this project.</Meta>
        <SummaryList
          label="API tokens"
          items={tokenItems(project, tokens, isAdmin)}
          emptyTitle="No tokens yet"
          emptyDescription="Create one for CI."
          add={add}
        />
        {tokens.length > 0 ? add : null}
      </Card>
      {isAdmin ? (
        <FormDialog id={CREATE_TOKEN_DIALOG} title="Create token" submitLabel="Create token" />
      ) : null}
    </VStack>
  );
}
