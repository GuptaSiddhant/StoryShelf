import { Alert, Button, Card, Field, PageHeader, VStack } from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

export interface InvitePageState {
  inviteId: string;
  token: string;
  email?: string;
  name?: string;
  error?: string;
}

/** Set-password page for invite acceptance (no auth required). */
export function renderInvitePage(state: InvitePageState): RenderedContent {
  return (
    <DocumentLayout title="Set password" layout="bare">
      <Card>
        <VStack gap="lg">
          <PageHeader
            title="Set your password"
            description={state.email ? `for ${state.email}` : undefined}
          />
          {state.error ? (
            <Alert tone="danger" title="Invite failed">
              {state.error}
            </Alert>
          ) : null}
          <form method="post" action={`/auth/invites/${state.inviteId}`} novalidate>
            <VStack>
              <input type="hidden" name="token" value={state.token} />
              {csrfField()}
              <Field
                label="New password"
                name="password"
                type="password"
                required
                autofocus
                autocomplete="new-password"
              />
              <Field
                label="Confirm password"
                name="confirm"
                type="password"
                required
                autocomplete="new-password"
              />
              <Button variant="primary" type="submit">
                Set password and sign in
              </Button>
            </VStack>
          </form>
        </VStack>
      </Card>
    </DocumentLayout>
  );
}

export function renderInviteInvalidPage(error: string): RenderedContent {
  return (
    <DocumentLayout title="Invite" layout="bare">
      <Card>
        <VStack gap="lg">
          <PageHeader title="Invite" />
          <Alert tone="danger" title="Invalid invite">
            {error}
          </Alert>
          <p>
            <a href="/auth/login">Back to sign in</a>
          </p>
        </VStack>
      </Card>
    </DocumentLayout>
  );
}
