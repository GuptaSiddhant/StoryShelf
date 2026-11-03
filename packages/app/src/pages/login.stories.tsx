// oxlint-disable typescript/promise-function-async -- story factories return Hono JSX (a Promise<HtmlEscapedString>)
import type { Meta } from "@storybook/html-vite";
import { pageStory } from "../../.storybook/page.tsx";
import { renderLoginPage, type EngineMethodLink } from "./login.tsx";

const meta: Meta = { title: "Pages/Account/Login" };
export default meta;

const password: EngineMethodLink = {
  kind: "password",
  id: "password",
  label: "Password",
  url: "/auth/engine/login",
};
const github: EngineMethodLink = {
  kind: "oauth",
  id: "github",
  label: "GitHub",
  url: "/auth/github",
};
const passkey: EngineMethodLink = {
  kind: "passkey",
  id: "passkey",
  label: "a passkey",
  url: "/auth/passkey",
};
const sso: EngineMethodLink = {
  kind: "sso",
  id: "okta",
  label: "Okta",
  url: "/auth/okta",
};

export const PasswordOnly = pageStory(() => renderLoginPage({ engineMethods: [password] }));

export const AllMethods = pageStory(() =>
  renderLoginPage({ engineMethods: [password, github, passkey, sso] }),
);

export const WrongPassword = pageStory(() =>
  renderLoginPage({
    engineMethods: [password],
    email: "ada@example.com",
    error: "That email and password don't match.",
  }),
);

export const NoMethodsConfigured = pageStory(() => renderLoginPage({ engineMethods: [] }));
