import type { AuthUser } from "@storyshelf/core/types";
import { safeImageUrl } from "@storyshelf/core/urls";
import type { FC } from "hono/jsx";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  HStack,
  PageHeader,
  Table,
  VStack,
} from "../ui/components.tsx";
import { csrfField } from "../ui/csrf-field.tsx";
import { css } from "../ui/css.ts";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";
import { passkeyRegisterScript } from "./passkey-ceremony.ts";

export interface ProfilePageState {
  user: AuthUser;
  dbUser?: {
    email: string;
    name: string;
    displayNameOverride: string | null;
    authProvider: string;
    lastLoginAt: string | null;
    createdAt: string;
  };
  memberships: Array<{ projectName: string; projectSlug: string; role: string; source: string }>;
  subscribedSlugs: string[];
  error?: string;
  success?: string;
  isLocal?: boolean;
  security?: {
    sessions: Array<{
      id: string;
      ipAddress: string | null;
      userAgent: string | null;
      createdAt: string;
      expiresAt: string;
      current: boolean;
    }>;
    passkeys: Array<{
      id: string;
      name: string | null;
      deviceType: string;
      backedUp: boolean;
      transports: string | null;
      aaguid: string | null;
      createdAt: string;
    }>;
    passkeysEnabled: boolean;
    hasPassword: boolean;
  };
}

const profileAvatar = css`
  /* profile-avatar */
  width: 64px;
  height: 64px;
  border-radius: 999px;
  object-fit: cover;
`;

const profileAvatarFallback = css`
  /* profile-avatar-fallback */
  width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
  background: var(--accent);
  color: #fff;
  border-radius: 999px;
  font-size: 1.5rem;
  font-weight: 700;
`;

const profileName = css`
  /* profile-name */
  font-weight: 700;
  font-size: 1.2rem;
`;

const profileMeta = css`
  /* profile-meta */
  color: var(--text-secondary);
  font-size: 0.85rem;
`;

/* eslint-disable promise-function-async -- JSX components return HtmlEscapedString */

type SecurityState = NonNullable<ProfilePageState["security"]>;
type PasskeyState = SecurityState["passkeys"][number];

/** Registered passkey rows with per-key remove actions. */
const PasskeyTable: FC<{ passkeys: PasskeyState[] }> = ({ passkeys }) => {
  return (
    <Table dense>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Added</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {passkeys.map(
            // oxlint-disable-next-line typescript/promise-function-async -- JSX map is sync
            (key) => (
              <tr key={key.id}>
                <td>
                  <div>{key.name ?? "Unnamed key"}</div>
                  <div class={profileMeta}>{key.deviceType}</div>
                </td>
                <td>{new Date(key.createdAt).toLocaleDateString()}</td>
                <td>
                  <HStack>
                    {key.backedUp ? <Badge>Synced</Badge> : null}
                    <form method="post" action={`/profile/passkeys/${key.id}/delete`}>
                      <Button variant="secondary" size="sm" type="submit">
                        Remove
                      </Button>
                    </form>
                  </HStack>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </Table>
  );
};

type SessionInfo = SecurityState["sessions"][number];

/** One signed-in device with its revoke action. */
const SessionRow: FC<{ session: SessionInfo }> = ({ session }) => {
  return (
    <tr>
      <td>
        <div class="truncate">{session.userAgent ?? "Unknown device"}</div>
        <div class={profileMeta}>
          <span class="mono">{session.ipAddress ?? "—"}</span>
        </div>
      </td>
      <td>{new Date(session.createdAt).toLocaleString()}</td>
      <td>
        {session.current ? (
          <Badge>This device</Badge>
        ) : (
          <form method="post" action="/profile/sessions/revoke">
            <input type="hidden" name="sessionId" value={session.id} />
            <Button variant="secondary" size="sm" type="submit">
              Revoke
            </Button>
          </form>
        )}
      </td>
    </tr>
  );
};

/** Active device sessions with per-device revoke and sign-out-others. */
const SessionsSection: FC<{ security: SecurityState }> = ({ security }) => {
  return (
    <Card>
      <PageHeader title="Devices" description="Where you are signed in" />
      <Table dense>
        <table>
          <thead>
            <tr>
              <th>Device</th>
              <th>Signed in</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {security.sessions.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </tbody>
        </table>
      </Table>
      {security.sessions.length > 1 ? (
        <form method="post" action="/profile/sessions/revoke-others">
          <Button variant="secondary" size="sm" type="submit">
            Sign out other devices
          </Button>
        </form>
      ) : null}
    </Card>
  );
};

/** Registered passkeys with delete, register button, and the backup nudge. */
const PasskeysSection: FC<{ security: SecurityState }> = ({ security }) => {
  return (
    <Card>
      <PageHeader title="Passkeys" description="Sign in without a password using your device" />
      {security.passkeys.length < 2 ? (
        <Alert title="Add a backup key">
          Register a 2nd key so a lost device doesn&apos;t lock you out.
        </Alert>
      ) : null}
      {security.passkeys.length === 0 ? (
        <p class={profileMeta}>No passkeys yet.</p>
      ) : (
        <PasskeyTable passkeys={security.passkeys} />
      )}
      <HStack>
        <Field label="Key name" name="keyName" type="text" placeholder="e.g. Security key" />
        <Button variant="primary" size="sm" type="button" data-passkey-register="true">
          Register a passkey
        </Button>
      </HStack>
      <p class={profileMeta} data-passkey-status="true" aria-live="polite">
        {""}
      </p>
      <script dangerouslySetInnerHTML={{ __html: passkeyRegisterScript() }} />
    </Card>
  );
};

/** Personal profile page (editable display name, password for local accounts). */
// oxlint-disable-next-line eslint/max-lines-per-function -- profile page composes several sections, cohesive
export function renderProfilePage(state: ProfilePageState): RenderedContent {
  const { user, dbUser, memberships, subscribedSlugs, error, success, isLocal, security } = state;
  const avatar = safeImageUrl(user.avatarUrl);
  const displayName = dbUser?.displayNameOverride ?? user.name;
  const provider = dbUser?.authProvider ?? user.providerId ?? "oidc";
  return (
    <DocumentLayout title="Profile" nav={{ active: "profile" }}>
      <PageHeader title="Profile" description="Your account and project memberships" />
      {error ? (
        <Alert tone="danger" title="Could not save">
          {error}
        </Alert>
      ) : null}
      {success ? (
        <Alert tone="success" title={success}>
          {success}
        </Alert>
      ) : null}

      <Card>
        <VStack>
          <HStack>
            {avatar ? (
              <img class={profileAvatar} src={avatar} alt="" width="64" height="64" />
            ) : (
              <span class={profileAvatarFallback} aria-hidden="true">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <VStack>
              <div class={profileName}>{displayName}</div>
              <div class={profileMeta}>{user.email}</div>
              <HStack>
                <Badge>{user.role}</Badge>
                <Badge>via {provider}</Badge>
              </HStack>
            </VStack>
          </HStack>
          <div class={profileMeta}>
            Member since {dbUser?.createdAt ? new Date(dbUser.createdAt).toLocaleDateString() : "—"}{" "}
            · Last login {dbUser?.lastLoginAt ? new Date(dbUser.lastLoginAt).toLocaleString() : "—"}
          </div>
        </VStack>
      </Card>

      <Card>
        <PageHeader
          title="Display name"
          description="Shown in comments and the header. Survives SSO refresh."
        />
        <form method="post" action="/profile" novalidate>
          <Field label="Display name" name="displayName" type="text" required value={displayName} />
          <Button variant="primary" type="submit">
            Save name
          </Button>
        </form>
      </Card>

      {isLocal ? (
        <Card>
          <PageHeader title="Change password" description="For local accounts only" />
          <form method="post" action="/profile/password" novalidate>
            <Field
              label="Current password"
              name="currentPassword"
              type="password"
              required
              autocomplete="current-password"
            />
            <Field
              label="New password"
              name="newPassword"
              type="password"
              required
              autocomplete="new-password"
            />
            <Field
              label="Confirm new password"
              name="confirmPassword"
              type="password"
              required
              autocomplete="new-password"
            />
            <Button variant="primary" type="submit">
              Change password
            </Button>
          </form>
        </Card>
      ) : null}

      {security ? <SessionsSection security={security} /> : null}

      {security?.passkeysEnabled ? <PasskeysSection security={security} /> : null}

      <Card>
        <PageHeader title="Project memberships" description="Your role on each project" />{" "}
        {memberships.length === 0 ? (
          <p class={profileMeta}>No project memberships.</p>
        ) : (
          <Table dense>
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Role</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {memberships.map(
                  // oxlint-disable-next-line typescript/promise-function-async -- JSX map is sync
                  (m) => (
                    <tr key={m.projectSlug}>
                      <td>
                        <a href={`/projects/${m.projectSlug}`}>{m.projectName}</a>
                      </td>
                      <td>
                        <Badge>{m.role}</Badge>
                      </td>
                      <td>{m.source}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </Table>
        )}
      </Card>

      <Card>
        <PageHeader
          title="Notifications"
          description="Email alerts per project. Fine-tune topics in each project's settings."
        />
        {memberships.length === 0 ? (
          <p class={profileMeta}>No project memberships.</p>
        ) : (
          <Table dense>
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Status</th>
                  <th>
                    <span class="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {memberships.map(
                  // oxlint-disable-next-line typescript/promise-function-async -- JSX map is sync
                  (m) => {
                    const subscribed = subscribedSlugs.includes(m.projectSlug);
                    return (
                      <tr key={m.projectSlug}>
                        <td>
                          <a href={`/projects/${m.projectSlug}`}>{m.projectName}</a>
                        </td>
                        <td>{subscribed ? <Badge>Email on</Badge> : <Badge>Off</Badge>}</td>
                        <td>
                          <form method="post" action="/profile/notifications">
                            {csrfField()}
                            <input type="hidden" name="slug" value={m.projectSlug} />
                            <input type="hidden" name="enabled" value={subscribed ? "" : "1"} />
                            <Button variant="secondary" size="sm" type="submit">
                              {subscribed ? "Disable" : "Enable"}
                            </Button>
                          </form>
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </Table>
        )}
      </Card>

      <Card>
        <form method="post" action="/auth/logout">
          {csrfField()}
          <Button variant="secondary" type="submit">
            Sign out
          </Button>
        </form>
      </Card>
    </DocumentLayout>
  );
}
