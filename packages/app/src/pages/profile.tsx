import type { AuthUser } from "@storyshelf/core/types";
import { safeImageUrl } from "@storyshelf/core/urls";
import type { FC } from "hono/jsx";
import { csrfField } from "../shell/csrf-field.tsx";
import { DocumentLayout, type RenderedContent } from "../shell/document.tsx";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Field,
  HStack,
  Meta,
  PageHeader,
  SectionTitle,
  Absent,
  RelativeTime,
  Table,
  VStack,
  statusLabel,
  Time,
} from "../ui/components.tsx";
import { css } from "../ui/css.ts";
import { NotificationsPausedNotice } from "./notifications-paused.tsx";
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
  /** Notifiers are wired but no public origin resolves (ADR 0014, decision 11). */
  notificationsPaused?: boolean | undefined;
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

const profileName = css`
  /* profile-name */
  font-weight: var(--weight-bold);
  font-size: var(--text-xl);
`;

const profileMeta = css`
  /* profile-meta */
  color: var(--text-secondary);
  font-size: var(--text-sm);
`;
type SecurityState = NonNullable<ProfilePageState["security"]>;
type PasskeyState = SecurityState["passkeys"][number];

/** Registered passkey rows with per-key remove actions. */
const PasskeyTable: FC<{ passkeys: PasskeyState[] }> = ({ passkeys }) => {
  return (
    <Table dense label="Passkeys" empty={passkeys.length === 0 ? "No passkeys yet." : undefined}>
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
                <td>
                  <Time value={key.createdAt} format="date" />
                </td>
                <td class="nowrap">
                  <HStack>
                    {key.backedUp ? <Badge>Synced</Badge> : null}
                    <form
                      method="post"
                      action={`/profile/passkeys/${key.id}/delete`}
                      data-confirm="Remove this passkey?"
                    >
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

/** One signed-in device with its revoke action (none for a read-only shared account). */
const SessionRow: FC<{ session: SessionInfo; readOnly: boolean }> = ({ session, readOnly }) => {
  return (
    <tr>
      <td>
        <div class="truncate">{session.userAgent ?? "Unknown device"}</div>
        <div class={profileMeta}>
          <span class="mono">{session.ipAddress ?? "—"}</span>
        </div>
      </td>
      <td class="nowrap">
        <RelativeTime value={session.createdAt} />
      </td>
      <td class="nowrap">
        {session.current ? (
          <Badge>This device</Badge>
        ) : readOnly ? null : (
          <form
            method="post"
            action="/profile/sessions/revoke"
            data-confirm="Sign this device out?"
          >
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
const SessionsSection: FC<{ security: SecurityState; readOnly: boolean }> = ({
  security,
  readOnly,
}) => {
  return (
    <Card>
      <SectionTitle>Devices</SectionTitle>
      <Meta>Where you are signed in</Meta>
      <Table dense label="Devices">
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
              <SessionRow key={session.id} session={session} readOnly={readOnly} />
            ))}
          </tbody>
        </table>
      </Table>
      {security.sessions.length > 1 && !readOnly ? (
        <form
          method="post"
          action="/profile/sessions/revoke-others"
          data-confirm="Sign out all other devices?"
        >
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
      <SectionTitle>Passkeys</SectionTitle>
      <Meta>Sign in without a password using your device</Meta>
      {security.passkeys.length < 2 ? (
        <Alert title="Add a backup key">
          Register a 2nd key so a lost device doesn&apos;t lock you out.
        </Alert>
      ) : null}
      <PasskeyTable passkeys={security.passkeys} />
      <HStack>
        <Field label="Key name" name="keyName" type="text" placeholder="e.g. Security key" />
        <Button variant="primary" type="button" data-passkey-register="true">
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

/** The display-name form. */
const DisplayNameCard: FC<{ displayName: string }> = ({ displayName }) => (
  <Card>
    <SectionTitle>Display name</SectionTitle>
    <Meta>Shown in comments and the header. Survives SSO refresh.</Meta>
    <form method="post" action="/profile" novalidate>
      <Field label="Display name" name="displayName" type="text" required value={displayName} />
      <Button variant="primary" type="submit">
        Save name
      </Button>
    </form>
  </Card>
);

/** The password form, for local accounts. */
const PasswordCard: FC = () => (
  <Card>
    <SectionTitle>Change password</SectionTitle>
    <Meta>For local accounts only</Meta>
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
);

/** The display-name and password forms; a read-only shared account (#1274) gets neither. */
const AccountForms: FC<{ displayName: string; isLocal: boolean; readOnly: boolean }> = ({
  displayName,
  isLocal,
  readOnly,
}) =>
  readOnly ? null : (
    <>
      <DisplayNameCard displayName={displayName} />
      {isLocal ? <PasswordCard /> : null}
    </>
  );

/** Personal profile page (editable display name, password for local accounts). */
// oxlint-disable-next-line eslint/max-lines-per-function -- profile page composes several sections, cohesive
export function renderProfilePage(state: ProfilePageState): RenderedContent {
  const { user, dbUser, memberships, subscribedSlugs, error, isLocal, security } = state;
  const avatar = safeImageUrl(user.avatarUrl);
  const displayName = dbUser?.displayNameOverride ?? user.name;
  const provider = dbUser?.authProvider ?? user.providerId ?? "oidc";
  // A read-only shared account (#1274) sees its profile but none of the controls that change it.
  const readOnly = user.readOnly === true;
  return (
    <DocumentLayout title="Profile" nav={{ active: "profile" }}>
      <PageHeader title="Profile" description="Your account and project memberships" />
      {error ? (
        <Alert tone="danger" title="Could not save">
          {error}
        </Alert>
      ) : null}

      <Card>
        <VStack>
          <HStack>
            {avatar ? (
              <img class={profileAvatar} src={avatar} alt="" width="64" height="64" />
            ) : (
              <Avatar name={user.name} size="xl" />
            )}
            <VStack>
              <div class={profileName}>{displayName}</div>
              <div class={profileMeta}>{user.email}</div>
              <HStack>
                <Badge>{statusLabel(user.role)}</Badge>
                <Badge>{statusLabel(`via ${provider}`)}</Badge>
              </HStack>
            </VStack>
          </HStack>
          <div class={profileMeta}>
            Member since{" "}
            {dbUser?.createdAt ? <Time value={dbUser.createdAt} format="date" /> : <Absent />} ·
            Last login {dbUser?.lastLoginAt ? <Time value={dbUser.lastLoginAt} /> : <Absent />}
          </div>
        </VStack>
      </Card>

      <AccountForms displayName={displayName} isLocal={isLocal === true} readOnly={readOnly} />

      {security ? <SessionsSection security={security} readOnly={readOnly} /> : null}

      {security?.passkeysEnabled && !readOnly ? <PasskeysSection security={security} /> : null}

      <Card>
        <SectionTitle>Project memberships</SectionTitle>
        <Meta>Your role on each project</Meta>{" "}
        {memberships.length === 0 ? (
          <p class={profileMeta}>No project memberships.</p>
        ) : (
          <Table dense label="Project memberships">
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
                        <Badge>{statusLabel(m.role)}</Badge>
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
        <SectionTitle>Notifications</SectionTitle>
        <Meta>Email alerts per project. Fine-tune topics in each project's settings.</Meta>
        <NotificationsPausedNotice paused={state.notificationsPaused} />
        {memberships.length === 0 ? (
          <p class={profileMeta}>No project memberships.</p>
        ) : (
          <Table dense label="Notification subscriptions">
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
                          {readOnly ? null : (
                            <form method="post" action="/profile/notifications">
                              {csrfField()}
                              <input type="hidden" name="slug" value={m.projectSlug} />
                              <input type="hidden" name="enabled" value={subscribed ? "" : "1"} />
                              <Button variant="secondary" size="sm" type="submit">
                                {subscribed ? "Disable" : "Enable"}
                              </Button>
                            </form>
                          )}
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
