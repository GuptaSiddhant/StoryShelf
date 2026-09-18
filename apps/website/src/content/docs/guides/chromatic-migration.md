---
title: Migrating from Chromatic
description: Step-by-step guide to move from Chromatic to StoryShelf — config, baselines, CI, and team workflow.
---

This guide walks through migrating an existing Chromatic project to StoryShelf. It assumes you have a Chromatic project with existing baselines and CI integration.

## Prerequisites

- A running StoryShelf server (see [Getting started](/guides/getting-started/))
- Admin access to your Chromatic project
- Ability to modify CI pipelines
- GitHub/GitLab admin for status check updates

## 1. Export baselines from Chromatic (manual — no API)

**Chromatic does not provide a public API to export baselines.** You cannot programmatically migrate baseline images.

**Workaround:** On first StoryShelf run, all snapshots will appear as "new" or "changed" (against default branch). Your team will need to re-accept them once. This is a one-time cost.

> **Tip:** If you have a small number of critical baselines, you can manually download them from Chromatic UI and upload via StoryShelf API, but this is not practical for large projects.

## 2. Deploy StoryShelf server

Follow [Getting started](/guides/getting-started/) to deploy:
- Choose database (SQLite for single-node, Turso/Postgres for serverless)
- Choose storage (local for single-node, S3-compatible for multi-node)
- Choose auth (OIDC recommended for teams)
- Configure Git provider (GitHub/GitLab) for status checks

## 3. Create project with matching settings

In StoryShelf UI or via CLI:
```bash
storyshelf create --url https://shelf.example.com --name "My Design System" --token $ADMIN_TOKEN
```

Match Chromatic settings where applicable:
- **Project name** → same as Chromatic
- **Default branch** → same as Chromatic (usually `main`)
- **Pixel threshold** → match Chromatic's threshold if customized
- **Viewports** → configure in server `ShelfConfig.viewports` to match Chromatic

## 4. Update CI pipeline

### Chromatic CI (before):
```yaml
- name: Chromatic
  uses: chromatic-action@v1
  with:
    projectToken: ${{ secrets.CHROMATIC_PROJECT_TOKEN }}
    buildScriptName: build-storybook
```

### StoryShelf CI (after):
```yaml
- name: Build Storybook
  run: npx build-storybook -o storybook-static

- name: Upload to StoryShelf
  run: npx storyshelf upload --token ${{ secrets.STORYSHELF_TOKEN }} --sha ${{ github.sha }} --branch ${{ github.ref_name }}
  env:
    STORYSHELF_URL: https://shelf.example.com
    STORYSHELF_SLUG: my-design-system
```

Or with `.storybook/storyshelf.json` committed:
```yaml
- name: Upload to StoryShelf
  run: npx storyshelf
  env:
    STORYSHELF_TOKEN: ${{ secrets.STORYSHELF_TOKEN }}
```

## 5. Parameter compatibility (dual-key)

StoryShelf reads both `chromatic:` and `storyshelf:` parameter keys. **`storyshelf:` wins on conflict.**

| Chromatic parameter | StoryShelf equivalent | Notes |
|---------------------|----------------------|-------|
| `disableSnapshot` | `disableSnapshot` | Works unchanged |
| `flakyTest` | `flakyTest` | Works unchanged |
| `delay` | `delay` | Works unchanged |
| `diffThreshold` | `diffThreshold` | Works unchanged |
| `pauseAnimationAtEnd` | `pauseAnimationAtEnd` | Works unchanged |
| `viewports` | Server config | Set in `ShelfConfig.viewports` |
| `modes` / `globals` | Not supported | **Gap** — no equivalent |

**No code changes needed** for existing `chromatic:` parameters. They work as-is.

## 6. Baseline model differences

| Chromatic | StoryShelf |
|-----------|------------|
| Global baseline + branch baselines | Per-branch baselines with default-branch fallback |
| Branch baselines independent | Feature branch accepts → branch baseline; merge to main → promotes to default |
| No GC (manual cleanup) | Auto GC: `branchTtlDays` (default 30), `purgeTtlDays` (default 30) |

**Implication:** On first run, feature branches will diff against `main` baseline. After accepting changes, they get their own branch baseline. Merging to `main` updates the default baseline automatically.

## 7. What you lose (honest gaps)

| Feature | Chromatic | StoryShelf | Impact |
|---------|-----------|------------|--------|
| **TurboSnap** | Yes (dependency graph) | No | 5-10× more snapshots on large Storybooks |
| **Cross-browser** | Chrome, FF, Safari, Edge | Chromium only | No Safari/FF/Edge coverage |
| **Modes/Globals** | Yes | No | Theme/locale matrices need workarounds |
| **A11y testing** | Yes (aXe) | No | Separate aXe job needed |
| **Cloud parallelization** | Automatic | Manual (`captureConcurrency`) | Limited by your server CPU/memory |
| **Baseline export** | UI only | API + UI | Cannot bulk-import Chromatic baselines |
| **Flake detection** | Auto-detect | Explicit `flakyTest` | Manual marking required |

## 8. What you gain

- **Zero per-snapshot cost** — Unlimited snapshots forever
- **Full data ownership** — Your DB, your storage, your network
- **No vendor lock-in** — MIT license, standard REST API, open source
- **Flexible SSO** — Any OIDC provider (Keycloak, Okta, Entra ID, etc.)
- **Deploy anywhere** — Node, Bun, Deno, Fly.io, Vercel, Cloudflare, Lambda, etc.
- **Per-branch baselines with fallback** — Cleaner for long-lived feature branches
- **Persistent builds** — Tag releases → never purged

## 9. Rollback plan

Keep Chromatic running in parallel for 1-2 sprints:

1. **Run both** — Add StoryShelf upload as additional CI step (don't remove Chromatic yet)
2. **Compare results** — Verify StoryShelf catches same regressions
3. **Team training** — Familiarize reviewers with StoryShelf UI
4. **Cutover** — Remove Chromatic step, update GitHub status check requirements
5. **Archive** — Export any critical Chromatic data before canceling subscription

## 10. Team onboarding checklist

- [ ] Reviewers know how to approve/reject in StoryShelf UI
- [ ] GitHub status check renamed from `chromatic` to `storyshelf/<project-slug>`
- [ ] Branch protection rules updated to require StoryShelf status
- [ ] CI secrets rotated (`CHROMATIC_PROJECT_TOKEN` → `STORYSHELF_TOKEN`)
- [ ] Documentation updated with StoryShelf workflow
- [ ] Chromatic subscription canceled (after verification period)

## FAQ

**Q: Can I import Chromatic baselines?**
A: No public API. Baselines must be re-accepted on first StoryShelf run.

**Q: Does StoryShelf support TurboSnap?**
A: Not implemented. Every changed story captures a full snapshot.

**Q: Can I test Safari/Firefox?**
A: No. StoryShelf uses Playwright Chromium only.

**Q: What about Modes/Globals?**
A: Not supported. Workaround: duplicate stories with different args, or use separate Storybook configs.

**Q: How do I handle flaky tests?**
A: Add `parameters: { storyshelf: { flakyTest: true } }` or tag `flaky-test` on the story. Build status stays green with warning.

**Q: Can I run both during migration?**
A: Yes. Add StoryShelf as additional CI step. Compare results before cutover.