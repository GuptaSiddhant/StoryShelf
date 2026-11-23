import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  evaluate,
  parseAdvisories,
  render,
  runAudit,
  stageWorkspace,
  validateExceptions,
} from "./audit-check.mjs";

const advisory = (id, module = "uuid", version = "9.0.1") => ({
  id,
  severity: "moderate",
  module,
  versions: [version],
  url: `https://github.com/advisories/${id}`,
});
const exception = (over = {}) => ({
  advisory: "GHSA-w5hq-g745-h8pq",
  target: "workspace",
  package: "uuid",
  reviewBy: "2027-02-18",
  issue: 335,
  ...over,
});
const report = (...items) =>
  JSON.stringify({
    advisories: Object.fromEntries(
      items.map((a, i) => [
        i,
        {
          github_advisory_id: a.id,
          severity: a.severity,
          module_name: a.module,
          url: a.url,
          findings: [{ version: a.versions[0] }],
          overview: "BODY",
        },
      ]),
    ),
  });

const runner =
  (stdout, status = 1, error = null) =>
  () => ({ stdout, status, error });

describe("audit-check evaluation", () => {
  it("reads advisories from an audit report and refuses anything else", () => {
    assert.deepEqual(parseAdvisories(report(advisory("GHSA-w5hq-g745-h8pq"))), [
      advisory("GHSA-w5hq-g745-h8pq"),
    ]);
    assert.deepEqual(parseAdvisories('{"advisories":{}}'), []);
    assert.throws(() => parseAdvisories('{"error":{"code":"ENOTFOUND"}}'), /no `advisories`/u);
    assert.throws(() => parseAdvisories("not json"));
  });

  it("passes a tracked advisory that is inside its review date", () => {
    const result = evaluate(
      { workspace: [advisory("GHSA-w5hq-g745-h8pq")] },
      [exception()],
      "2026-11-20",
    );
    assert.equal(result.accepted.length, 1);
    assert.deepEqual(render(result, []).failures, []);
  });

  it("fails an advisory that is not an exception, or is one for another target", () => {
    const other = evaluate(
      { "storybook-8": [advisory("GHSA-w5hq-g745-h8pq")] },
      [exception()],
      "2026-11-20",
    );
    assert.equal(other.unlisted.length, 1);
    assert.equal(other.unused.length, 1);
    const { failures, markdown } = render(other, []);
    assert.match(failures[0], /^Unlisted advisory: GHSA-w5hq-g745-h8pq uuid 9\.0\.1/u);
    assert.match(markdown, /unlisted: fails/u);
  });

  it("fails an exception past its review date, and the day of it still passes", () => {
    const reports = { workspace: [advisory("GHSA-w5hq-g745-h8pq")] };
    assert.equal(evaluate(reports, [exception()], "2027-02-18").expired.length, 0);
    const late = evaluate(reports, [exception()], "2027-02-19");
    assert.equal(late.expired.length, 1);
    assert.match(render(late, []).failures[0], /past its review date 2027-02-18/u);
  });

  it("reports an exception that matched nothing as a notice, not a failure", () => {
    const result = evaluate({ workspace: [] }, [exception()], "2026-11-20");
    const { failures, markdown } = render(result, []);
    assert.deepEqual(failures, []);
    assert.match(markdown, /matched nothing/u);
  });
});

describe("audit-check inputs", () => {
  it("validates the exception file against SECURITY.md", () => {
    const security = "GHSA-w5hq-g745-h8pq";
    assert.deepEqual(validateExceptions([exception()], security), []);
    const bad = validateExceptions(
      [
        exception({ advisory: "nope", target: "x", reviewBy: "2027-13-45", issue: undefined }),
        exception({ advisory: "GHSA-aaaa-bbbb-cccc" }),
      ],
      security,
    );
    assert.equal(bad.length, 7);
    assert.match(bad.join("\n"), /not listed in SECURITY\.md/u);
  });

  it("treats output that is not a report as a failed audit, whatever the exit code", () => {
    assert.equal(runAudit("/x", runner(report(advisory("GHSA-w5hq-g745-h8pq")))).length, 1);
    assert.throws(() => runAudit("/x", runner("<html>502</html>")), /gave no report \(exit 1\)/u);
    assert.throws(
      () => runAudit("/x", runner("", null, new Error("ENOENT"))),
      /could not run pnpm audit/u,
    );
  });
});

const seedManifests = (root) => {
  writeFileSync(join(root, "package.json"), "{}");
  writeFileSync(join(root, "nub.lock"), "lock");
  for (const dir of ["packages/a", "apps/b", "packages/empty"])
    mkdirSync(join(root, dir), { recursive: true });
  for (const dir of ["packages/a", "apps/b"]) writeFileSync(join(root, dir, "package.json"), "{}");
};

describe("audit-check staging", () => {
  it("stages nub.lock and the manifests without touching the source", () => {
    const root = mkdtempSync(join(tmpdir(), "audit-root-"));
    const into = mkdtempSync(join(tmpdir(), "audit-into-"));
    seedManifests(root);
    stageWorkspace(root, into);
    assert.equal(readFileSync(join(into, "pnpm-lock.yaml"), "utf8"), "lock");
    assert.equal(readFileSync(join(into, "packages/a/package.json"), "utf8"), "{}");
    assert.match(readFileSync(join(into, "pnpm-workspace.yaml"), "utf8"), /packages\/\*/u);
    assert.throws(() => readFileSync(join(into, "packages/empty/package.json")));
  });
});
