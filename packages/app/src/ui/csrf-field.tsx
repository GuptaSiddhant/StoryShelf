import { getCsrfToken } from "../middleware/csrf.ts";
import { getStore } from "../store.ts";

/** Hidden CSRF token so native (non-HTMX) form posts pass the csrf middleware. */
export function csrfField(): unknown {
  const { config } = getStore();
  return <input type="hidden" name="csrf_token" value={getCsrfToken(config.secret)} />;
}
