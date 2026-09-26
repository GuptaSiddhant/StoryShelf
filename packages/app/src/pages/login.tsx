import { getStore } from "../store.ts";
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
  /** Whether to show the local account (email+password) form. */
  accountEnabled?: boolean;
  /** Pre-filled email for the account form (e.g. after failed login). */
  email?: string;
}

/** Resolve auth UI text with defaults. */
function authUi(): NonNullable<import("@storyshelf/core/config").UIConfig["auth"]> {
  try {
    return getStore().ui.auth ?? {};
  } catch {
    return {};
  }
}

function ssoLabel(template: string | undefined, label: string): string {
  const raw = template ?? "Sign in with {label}";
  return raw.includes("{label}") ? raw.replaceAll("{label}", label) : `${raw} ${label}`;
}

function renderSso(
  ssoUrl: string | undefined,
  ssoProviders: SsoProviderLink[] | undefined,
  template: string | undefined,
): unknown {
  if (!ssoUrl && (!ssoProviders || ssoProviders.length === 0)) {
    return null;
  }
  return (
    <div class="mt-1">
      <VStack>
        <Meta center>or</Meta>
        {ssoUrl ? (
          <Button variant="secondary" href={ssoUrl}>
            {ssoLabel(template, "SSO")}
          </Button>
        ) : null}
        {(ssoProviders ?? []).map(
          // oxlint-disable-next-line typescript/promise-function-async -- JSX map is sync
          (provider) => (
            <Button variant="secondary" href={provider.url} key={provider.id}>
              {ssoLabel(template, provider.label)}
            </Button>
          ),
        )}
      </VStack>
    </div>
  );
}

/** Sign-in page with password form and optional SSO button. */
// oxlint-disable-next-line eslint/max-lines-per-function -- page composes a few sections, still one concern
export function renderLoginPage(state: LoginPageState = {}): RenderedContent {
  const ui = authUi();
  const title = ui.title ?? "Sign in";
  const subtitle = ui.subtitle;
  const passwordLabel = ui.passwordLabel ?? "Password";
  const submitLabel = ui.submitLabel ?? "Sign in";
  return (
    <DocumentLayout title={title}>
      <div class="login">
        <Card>
          <PageHeader title={title} description={subtitle} />

          {state.error ? (
            <Alert tone="danger" title="Could not sign in">
              {state.error}
            </Alert>
          ) : null}

          {state.accountEnabled ? (
            <form method="post" action="/auth/account/login" novalidate>
              <Field
                label="Email"
                name="email"
                type="email"
                required
                value={state.email}
                autocomplete="email"
              />
              <Field
                label={passwordLabel}
                name="password"
                type="password"
                required
                autocomplete="current-password"
                placeholder={ui.passwordPlaceholder}
              />
              <Button variant="primary" type="submit">
                {submitLabel}
              </Button>
            </form>
          ) : null}

          {state.passwordEnabled === false ? null : (
            <form method="post" action="/auth/login" novalidate>
              <Field
                label={passwordLabel}
                name="password"
                type="password"
                required
                autofocus={!state.accountEnabled}
                autocomplete="current-password"
                placeholder={ui.passwordPlaceholder}
              />
              <Button variant="primary" type="submit">
                {submitLabel}
              </Button>
            </form>
          )}

          {ui.helpText ? (
            <p class="login__help">
              <Meta>{ui.helpText}</Meta>
            </p>
          ) : null}

          {renderSso(state.ssoUrl, state.ssoProviders, ui.ssoLabelTemplate)}
          {ui.footerText ? (
            <p class="login__footer">
              <Meta>{ui.footerText}</Meta>
            </p>
          ) : null}
        </Card>
      </div>
    </DocumentLayout>
  );
}
