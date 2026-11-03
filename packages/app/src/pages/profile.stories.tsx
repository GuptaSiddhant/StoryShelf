// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import { renderProfilePage, type ProfilePageState } from "./profile.tsx";

const meta: Meta = { title: "Pages/Account/Profile" };
export default meta;

const state = (overrides: Partial<ProfilePageState> = {}): ProfilePageState => ({
  user: {
    id: "01JD000000000000000000USR001",
    email: "ada@example.com",
    name: "Ada Lovelace",
    role: "admin",
  },
  dbUser: {
    email: "ada@example.com",
    name: "Ada Lovelace",
    displayNameOverride: null,
    authProvider: "password",
    lastLoginAt: "2026-01-15T08:00:00.000Z",
    createdAt: "2025-11-01T09:00:00.000Z",
  },
  memberships: [
    { projectName: "Design system", projectSlug: "design-system", role: "admin", source: "direct" },
    { projectName: "Web app", projectSlug: "web-app", role: "viewer", source: "group" },
  ],
  subscribedSlugs: ["design-system"],
  security: {
    sessions: [
      {
        id: "s1",
        ipAddress: "203.0.113.7",
        userAgent: "Chrome on macOS",
        createdAt: "2026-01-14T09:00:00.000Z",
        expiresAt: "2026-02-14T09:00:00.000Z",
        current: true,
      },
    ],
    passkeys: [
      {
        id: "pk1",
        name: "MacBook",
        deviceType: "multiDevice",
        backedUp: true,
        transports: "internal",
        aaguid: null,
        createdAt: "2025-12-01T09:00:00.000Z",
      },
    ],
    passkeysEnabled: true,
    hasPassword: true,
  },
  ...overrides,
});

export const Default = pageStory(() => renderProfilePage(state()), {
  store: { authEnabled: true },
});

export const NoMemberships = pageStory(
  () => renderProfilePage(state({ memberships: [], subscribedSlugs: [] })),
  { store: { authEnabled: true } },
);

export const WithError = pageStory(
  () => renderProfilePage(state({ error: "That display name is too long." })),
  { store: { authEnabled: true } },
);

export const NotificationsPaused = pageStory(
  () => renderProfilePage(state({ notificationsPaused: true })),
  { store: { authEnabled: true } },
);
