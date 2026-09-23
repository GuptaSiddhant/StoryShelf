import { Alert, Button, Card, Field, PageHeader } from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

/** Form state for the sign-in page (SSO link and error message). */
export interface LoginPageState {
  ssoUrl?: string;
  error?: string;
}

/** Sign-in page with password form and optional SSO button. */
export function renderLoginPage(state: LoginPageState = {}): RenderedContent {
  return (
    <DocumentLayout title="Sign in">
      <div class="login">
        <Card>
          <PageHeader title="Sign in" />

          {state.error ? (
            <Alert tone="danger" title="Could not sign in">
              {state.error}
            </Alert>
          ) : null}

          <form method="post" action="/auth/login" novalidate>
            <Field
              label="Password"
              name="password"
              type="password"
              required
              autofocus
              autocomplete="current-password"
            />
            <Button variant="primary" type="submit">
              Sign in
            </Button>
          </form>

          {state.ssoUrl ? (
            <div class="stack mt-1" style="text-align:center;">
              <span class="muted">or</span>
              <Button variant="secondary" href={state.ssoUrl}>
                Sign in with SSO
              </Button>
            </div>
          ) : null}
        </Card>
      </div>
    </DocumentLayout>
  );
}
