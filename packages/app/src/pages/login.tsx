import { getStore } from "../store.ts";
import { Alert, Button, Card, Field, Meta, PageHeader, VStack } from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
import { passkeyLoginScript } from "./passkey-ceremony.ts";

/** One engine login widget (descriptor-driven). */
export interface EngineMethodLink {
  kind: "password" | "oauth" | "passkey" | "sso";
  id: string;
  label: string;
  url: string;
}

/** Form state for the sign-in page (engine widgets and error message). */
export interface LoginPageState {
  error?: string;
  /** Engine login widgets (descriptor-driven). */
  engineMethods?: EngineMethodLink[];
  /** Pre-filled email for the password form (e.g. after failed login). */
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

/** Sign-in page with engine login widgets. */
// oxlint-disable-next-line eslint/max-lines-per-function -- page composes a few sections, still one concern
export function renderLoginPage(state: LoginPageState = {}): RenderedContent {
  const ui = authUi();
  const title = ui.title ?? "Sign in";
  const subtitle = ui.subtitle;
  const passwordLabel = ui.passwordLabel ?? "Password";
  const submitLabel = ui.submitLabel ?? "Sign in";
  return (
    <DocumentLayout title={title} layout="bare">
      <Card>
        <VStack gap="lg">
          <PageHeader title={title} description={subtitle} />

          {state.error ? (
            <Alert tone="danger" title="Could not sign in">
              {state.error}
            </Alert>
          ) : null}

          {state.engineMethods?.some((method) => method.kind === "password") ? (
            <form method="post" action="/auth/engine/login" novalidate>
              <VStack>
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
              </VStack>
            </form>
          ) : null}

          {state.engineMethods
            ?.filter((method) => method.kind === "oauth" || method.kind === "sso")
            .map(
              // oxlint-disable-next-line typescript/promise-function-async -- JSX map is sync
              (provider) => (
                <Button variant="secondary" href={provider.url} key={provider.id}>
                  {ssoLabel(ui.ssoLabelTemplate, provider.label)}
                </Button>
              ),
            )}

          {state.engineMethods?.some((method) => method.kind === "passkey") ? (
            <div class="mt-1">
              <VStack>
                <Meta center>or</Meta>
                <Button variant="secondary" type="button" data-passkey-login="true">
                  Sign in with a passkey
                </Button>
                <p class="login__help" data-passkey-login-status="true" aria-live="polite">
                  <Meta />
                </p>
              </VStack>
              <script dangerouslySetInnerHTML={{ __html: passkeyLoginScript() }} />
            </div>
          ) : null}

          {ui.helpText ? (
            <p class="login__help">
              <Meta>{ui.helpText}</Meta>
            </p>
          ) : null}

          {ui.footerText ? (
            <p class="login__footer">
              <Meta>{ui.footerText}</Meta>
            </p>
          ) : null}
        </VStack>
      </Card>
    </DocumentLayout>
  );
}
