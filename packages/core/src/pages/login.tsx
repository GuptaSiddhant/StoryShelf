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
      <div class="login" style="max-width: 360px; margin: 3rem auto;">
        <div class="card card--padded">
          <h1 style="margin-top:0;">Sign in</h1>

          {state.error ? (
            <div class="alert alert--danger" role="alert">
              <strong class="alert__title">Could not sign in</strong>
              <div class="alert__body">{state.error}</div>
            </div>
          ) : null}

          <form method="post" action="/auth/login" novalidate>
            <div class="field">
              <label class="field__label" for="password">
                Password
              </label>
              <input
                class="field__input"
                id="password"
                name="password"
                type="password"
                required
                autofocus
                autocomplete="current-password"
              />
            </div>
            <button class="btn btn--primary" type="submit" style="width:100%; margin-top:1rem;">
              Sign in
            </button>
          </form>

          {state.ssoUrl ? (
            <div style="margin-top:1rem; text-align:center;">
              <span style="color: var(--color-text-secondary); font-size:.875rem;">or</span>
              <a class="btn btn--secondary" href={state.ssoUrl} style="display:block; margin-top:.5rem;">
                Sign in with SSO
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </DocumentLayout>
  );
}