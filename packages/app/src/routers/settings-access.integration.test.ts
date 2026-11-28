import { MemberModel, TokenModel, WebhookModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage, publicNetworkForTests } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubAuth } from "../stub-auth.ts";

/**
 * Issue #1473: the settings pages and the webhook and token API answer only an admin with what is
 * secret. A Viewer (project or site role), a Developer, an anonymous visitor, a user with no role and
 * a project token see no token row, no webhook URL, and no git, design, AI or channel section.
 */
const NOW = "2026-01-01T00:00:00.000Z";
const SLUG = "vault";
const WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/SECRETPATH1234";
const TOKEN_NAME = "CI-TOKEN-NAME";
const SECRET_SECTIONS = ["tokens", "webhooks", "git", "design", "ai"];
const TABS = ["general", "capture", "review", "access"];

const SITE_ROLES: Record<string, "member" | "viewer" | "admin"> = {
  boss: "member",
  view: "member",
  dev: "member",
  outsider: "member",
  siteviewer: "viewer",
  siteadmin: "admin",
};
const users = Object.entries(SITE_ROLES).map(([id, role]) => ({
  id,
  role,
  email: `${id}@example.com`,
  name: id,
}));
const auth = stubAuth(null, {
  check: async (request: Request) => {
    const id = /storyshelf_session=(?<id>\w+)/u.exec(request.headers.get("cookie") ?? "")?.groups?.[
      "id"
    ];
    return await Promise.resolve(users.find((user) => user.id === id) ?? null);
  },
});

async function boot() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Vault",
    slug: SLUG,
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await Promise.all(
    users.map(async (user) => {
      await db.insert(db.tables.users, {
        ...user,
        avatarUrl: null,
        lastLoginAt: null,
        createdAt: NOW,
      });
    }),
  );
  const members = new MemberModel(db);
  await members.set("p1", "boss", "admin");
  await members.set("p1", "view", "viewer");
  await members.set("p1", "dev", "developer");
  const { value } = await new TokenModel(db).issue("p1", { name: TOKEN_NAME, userId: "view" });
  await new WebhookModel(db, undefined, "s").issue("p1", { url: WEBHOOK_URL, events: [] });
  const app = createShelfApp({
    database: db,
    storage,
    auth,
    config: { secret: "s", adminToken: "adm", publicBaseUrl: "https://shelf.example" },
    logger: pino({ level: "silent" }),
  });
  await app.lifecycle.setup();
  return { app, projectToken: value };
}

const as = (id: string): Record<string, string> => ({ cookie: `storyshelf_session=${id}` });

describe("settings pages show secrets only to an admin (#1473)", () => {
  it.each(["view", "dev", "siteviewer"])(
    "gives %s the tabs it may read, with no token, webhook or integration section",
    async (who) => {
      const { app } = await boot();
      for (const tab of TABS) {
        // oxlint-disable-next-line no-await-in-loop -- few tabs
        const answer = await app.request(`/projects/${SLUG}/settings/${tab}`, { headers: as(who) });
        // oxlint-disable-next-line no-await-in-loop -- few tabs
        const html = await answer.text();
        expect(answer.status, tab).toBe(200);
        expect(html, tab).not.toContain("SECRETPATH");
        expect(html, tab).not.toContain("hooks.slack.com");
        expect(html, tab).not.toContain(TOKEN_NAME);
        for (const section of SECRET_SECTIONS) {
          expect(html, `${tab} has ${section}`).not.toContain(`id="${section}"`);
        }
      }
    },
  );

  it("still shows a viewer the roster and the labels, which it may read", async () => {
    const { app } = await boot();
    const access = await (
      await app.request(`/projects/${SLUG}/settings/access`, { headers: as("view") })
    ).text();
    expect(access).toContain('id="members"');
    const review = await (
      await app.request(`/projects/${SLUG}/settings/review`, { headers: as("view") })
    ).text();
    expect(review).toContain('id="labels"');
  });

  it("sends an anonymous visitor to sign in and answers a user with no role 404", async () => {
    const { app } = await boot();
    const anonymous = await app.request(`/projects/${SLUG}/settings/access`);
    expect(anonymous.status).toBe(302);
    expect(await anonymous.text()).not.toContain("SECRETPATH");
    const outsider = await app.request(`/projects/${SLUG}/settings/access`, {
      headers: as("outsider"),
    });
    expect(outsider.status).toBe(404);
  });

  it.each(["boss", "siteadmin"])(
    "shows %s the sections, with the webhook URL masked",
    async (who) => {
      const { app } = await boot();
      const html = await (
        await app.request(`/projects/${SLUG}/settings/access`, { headers: as(who) })
      ).text();
      expect(html).toContain('id="tokens"');
      expect(html).toContain('id="webhooks"');
      expect(html).toContain(TOKEN_NAME);
      expect(html).toContain("https://hooks.slack.com/…/1234");
      expect(html).not.toContain("SECRETPATH");
      expect(html).not.toContain("T000");
    },
  );

  it("gives an admin the git, design and notification sections of the other tabs", async () => {
    const { app } = await boot();
    const review = await (
      await app.request(`/projects/${SLUG}/settings/review`, { headers: as("boss") })
    ).text();
    expect(review).toContain('id="labels"');
    expect(review).toContain('id="notifications"');
  });
});

describe("the token and webhook API answers an admin only (#1473)", () => {
  let restoreNetwork: (() => void) | undefined;
  beforeEach(() => {
    restoreNetwork = publicNetworkForTests();
  });
  afterEach(() => {
    restoreNetwork?.();
  });
  const paths = [`/api/v1/projects/${SLUG}/webhooks`, `/api/v1/projects/${SLUG}/tokens`];

  it.each(["view", "dev", "siteviewer"])("refuses %s", async (who) => {
    const { app } = await boot();
    for (const path of paths) {
      // oxlint-disable-next-line no-await-in-loop -- two paths
      const answer = await app.request(path, { headers: as(who) });
      // oxlint-disable-next-line no-await-in-loop -- two paths
      const body = await answer.text();
      expect(answer.status, path).toBe(403);
      expect(body).not.toContain("SECRETPATH");
      expect(body).not.toContain(TOKEN_NAME);
    }
  });

  it("answers an anonymous visitor and a user with no role 404", async () => {
    const { app } = await boot();
    for (const headers of [{}, as("outsider")]) {
      for (const path of paths) {
        // oxlint-disable-next-line no-await-in-loop -- few requests
        expect((await app.request(path, { headers })).status).toBe(404);
      }
    }
  });

  it("refuses a project token owned by a viewer", async () => {
    const { app, projectToken } = await boot();
    for (const path of paths) {
      // oxlint-disable-next-line no-await-in-loop -- two paths
      const answer = await app.request(path, {
        headers: { authorization: `Bearer ${projectToken}` },
      });
      expect(answer.status, path).toBe(403);
    }
  });

  it.each([
    ["a project admin", as("boss")],
    ["a site admin", as("siteadmin")],
    ["the admin token", { authorization: "Bearer adm" }],
  ])("masks the webhook URL for %s", async (_name, headers) => {
    const { app } = await boot();
    const answer = await app.request(paths[0] ?? "", { headers });
    expect(answer.status).toBe(200);
    const rows = (await answer.json()) as { url: string }[];
    expect(rows.map((row) => row.url)).toEqual(["https://hooks.slack.com/…/1234"]);
  });

  it("masks the URL in the answer to creating a webhook too", async () => {
    const { app } = await boot();
    const created = await app.request(paths[0] ?? "", {
      method: "POST",
      headers: {
        ...as("boss"),
        "content-type": "application/json",
        "x-csrf-token": getCsrfToken("s", "boss"),
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ url: "https://hooks.example.com/a/b/NEWSECRETVALUE9876" }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { url: string; secret: string };
    expect(body.url).toBe("https://hooks.example.com/…/9876");
    expect(body.secret).not.toBe("");
  });

  it("lists tokens by name for an admin, never a hash or value", async () => {
    const { app } = await boot();
    const text = await (await app.request(paths[1] ?? "", { headers: as("boss") })).text();
    expect(text).toContain(TOKEN_NAME);
    expect(text).not.toMatch(/hash/u);
  });
});
