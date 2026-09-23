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
        <div class="card card--padded">
          <h1 class="page-header__title">Sign in</h1>

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
            <button class="btn btn--primary" type="submit">
              Sign in
            </button>
          </form>

          {state.ssoUrl ? (
            <div class="stack mt-1" style="text-align:center;">
              <span class="muted">or</span>
              <a class="btn btn--secondary" href={state.ssoUrl}>
                Sign in with SSO
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </DocumentLayout>
  );
}
