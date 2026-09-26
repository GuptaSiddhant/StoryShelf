import { Alert, Button, Card, Field, Meta, PageHeader, VStack } from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

/** One SSO button on the sign-in page. */
export interface SsoProviderLink {
  id: string;
  label: string;
  url: string;
}

/** Form state for the sign-in page (SSO link(s) and error message). */
export interface LoginPageState {
  ssoUrl?: string;
  ssoProviders?: SsoProviderLink[];
  error?: string;
  /** Whether to show the shared-password form. Defaults to true for backward compat. */
  passwordEnabled?: boolean;
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

          {state.passwordEnabled === false ? null : (
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
          )}

          {state.ssoUrl || (state.ssoProviders && state.ssoProviders.length > 0) ? (
            <div class="mt-1">
              <VStack>
                <Meta center>or</Meta>
                {state.ssoUrl ? (
                  <Button variant="secondary" href={state.ssoUrl}>
                    Sign in with SSO
                  </Button>
                ) : null}
                {(state.ssoProviders ?? []).map(
                  // oxlint-disable-next-line typescript/promise-function-async -- JSX map is sync
                  (provider) => (
                    <Button variant="secondary" href={provider.url} key={provider.id}>
                      Sign in with {provider.label}
                    </Button>
                  ),
                )}
              </VStack>
            </div>
          ) : null}
        </Card>
      </div>
    </DocumentLayout>
  );
}
