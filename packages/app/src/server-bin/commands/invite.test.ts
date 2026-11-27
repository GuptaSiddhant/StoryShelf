import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { instanceDir, recordingIo } from "../__fixtures__/instance-dir.ts";
import { runServerBin } from "../main.ts";

const TOKEN = "inv_cli-secret";
const STUB = fileURLToPath(new URL("../../stub-auth.ts", import.meta.url));

/** An instance with an auth whose invites are staged in memory, so the link is known. */
function instanceWithAuth() {
  return instanceDir({
    source: `import { defineShelfInstance } from "\${APP}";
import { fixtureOptions } from "\${FIXTURE}";
import { stubAuth } from ${JSON.stringify(STUB)};
export default defineShelfInstance(async () => ({
  ...fixtureOptions("\${DATA}"),
  auth: stubAuth(null, {
    issueInvite: async () => ({ inviteId: "i1", token: "${TOKEN}", expiresAt: "2026-12-04T00:00:00.000Z" }),
  }),
}));
`,
  });
}

describe("invite command", () => {
  it("prints the link once on stdout and nothing secret on stderr", async () => {
    const { dir } = instanceWithAuth();
    const mig = recordingIo();
    expect(await runServerBin(["migrate", "--dir", dir], mig, {}), mig.stderr.join()).toBe(0);
    const io = recordingIo();
    const code = await runServerBin(["invite", "ana@example.com", "--dir", dir], io, {
      SHELF_ADMIN_TOKEN: "test-admin",
    });
    expect(code).toBe(0);
    expect(io.stdout).toEqual([`/auth/invites/i1?token=${TOKEN}`]);
    expect(io.stderr.join("\n")).not.toContain(TOKEN);
  });

  it("refuses an invalid role and leaves nothing printed", async () => {
    const { dir } = instanceWithAuth();
    const io = recordingIo();
    const code = await runServerBin(
      ["invite", "ana@example.com", "--role", "root", "--dir", dir],
      io,
      {},
    );
    expect(code).toBe(1);
    expect(io.stdout).toEqual([]);
  });
});
