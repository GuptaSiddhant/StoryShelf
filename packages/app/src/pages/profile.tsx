import type { AuthUser } from "@storyshelf/core/adapter/auth";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  HStack,
  PageHeader,
  VStack,
} from "../ui/components.tsx";
import { css } from "../ui/css.ts";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

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
  error?: string;
  success?: string;
  isLocal?: boolean;
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

const membershipTable = css`
  /* profile-memberships */
  width: 100%;
  border-collapse: collapse;
  & th,
  & td {
    text-align: left;
    padding: 0.5rem 0.625rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.9rem;
  }
  & th {
    color: var(--text-secondary);
    font-weight: 600;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
`;

/** Personal profile page (editable display name, password for local accounts). */
// oxlint-disable-next-line eslint/max-lines-per-function -- profile page composes several sections, cohesive
export function renderProfilePage(state: ProfilePageState): RenderedContent {
  const { user, dbUser, memberships, error, success, isLocal } = state;
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
            {user.avatarUrl ? (
              <img class={profileAvatar} src={user.avatarUrl} alt="" width="64" height="64" />
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
                {user.groups && user.groups.length > 0 ? (
                  <Badge>{user.groups.join(", ")}</Badge>
                ) : null}
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

      <Card>
        <PageHeader title="Project memberships" description="Your role on each project" />
        {memberships.length === 0 ? (
          <p class={profileMeta}>No project memberships.</p>
        ) : (
          <table class={membershipTable}>
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
        )}
      </Card>

      <Card>
        <form method="post" action="/auth/logout">
          <Button variant="secondary" type="submit">
            Sign out
          </Button>
        </form>
      </Card>
    </DocumentLayout>
  );
}
