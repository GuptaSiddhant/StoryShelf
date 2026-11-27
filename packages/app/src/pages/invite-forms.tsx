import type { FC } from "hono/jsx";
import {
  Alert,
  Button,
  CodeBlock,
  Field,
  FormActions,
  Meta,
  SelectField,
  statusLabel,
} from "../ui/components.tsx";
import { DialogForm } from "./dialog-form.tsx";

/** Dialog id of the invite form. */
export const INVITE_DIALOG = "invite-user";

const SITE_ROLES = ["member", "viewer", "admin"] as const;
const roleOptions = SITE_ROLES.map((role) => ({ value: role, label: statusLabel(role) }));

/** The invite form: an email, an optional name and the site role. Site admins only. */
export const InviteForm: FC<{
  standalone: boolean;
  email?: string | undefined;
  error?: string | undefined;
}> = ({ standalone, email, error }) => {
  return (
    <DialogForm
      dialog={INVITE_DIALOG}
      action="/admin/invites"
      submitLabel="Create invite link"
      standalone={standalone}
      backHref="/admin"
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field
        label="Email"
        name="email"
        type="email"
        required
        value={email ?? ""}
        placeholder="name@example.com"
        hint="Inviting an address that already has an account issues a fresh link, which is also how a password is recovered."
      />
      <Field label="Name" name="name" placeholder="Defaults to the part before the @" />
      <SelectField label="Site role" name="role" options={roleOptions} />
    </DialogForm>
  );
};

/**
 * The one-time link, shown once. The page that carries it is `no-store`; nothing else keeps it, so
 * it is lost when the page is left. `link` is the absolute address when an origin is confirmed.
 */
export const InviteLink: FC<{
  link: string;
  email: string;
  expiresAt: string;
  absolute: boolean;
}> = ({ link, email, expiresAt, absolute }) => {
  return (
    <div>
      <Alert tone="success">Invite created for {email}. This link is shown once.</Alert>
      <CodeBlock code={link} label="Copy link" />
      <Meta>
        Copy it now and send it to {email} yourself (StoryShelf sends no email). It works once and
        expires on {expiresAt.slice(0, 10)}.
        {absolute ? "" : " No public origin is confirmed, so add your server's address in front."}
      </Meta>
      <FormActions>
        <Button variant="secondary" href="/admin">
          Done
        </Button>
      </FormActions>
    </div>
  );
};
