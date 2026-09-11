# StoryShelf Architecture Diagrams

> Visual companion to [`architecture.md`](./architecture.md) and [`repo-structure.md`](./repo-structure.md).
> All diagrams are [Mermaid](https://mermaid.js.org/) — rendered natively on GitHub and in most Markdown previews.
> Source of truth for entities/interfaces remains `architecture.md`; these diagrams are derived views.

---

## 1. System Context (C4 Level 1)

Who uses StoryShelf and what it touches. The server is self-hosted — no vendor cloud in the loop.

```mermaid
flowchart TB
    Dev["Developer"]
    Rev["Reviewer / Designer"]
    CI["CI Runner\n(GitHub Actions / GitLab CI)"]

    subgraph StoryShelf["StoryShelf — Self-Hosted"]
        CLI["storyshelf CLI\npackages/cli"]
        Server["StoryShelf Server\nHono + @storyshelf/app"]
        Core["Domain Core\n@storyshelf/core"]
    end

    GH["Git Provider\nGitHub / GitLab\n(status checks, MR comments)"]
    Store["Storage\nLocal FS / S3 / R2 / MinIO"]
    DB["Database\nSQLite (node:sqlite) / Turso"]
    Browser["Playwright Chromium\n@storyshelf/runner-playwright"]

    SB["Storybook Static Build\n(storybook-static/)"]

    Dev -- "writes stories" --> SB
    CI -- "npx storyshelf upload\n(zip + sha/branch/message)" --> Server
    CLI -- "upload / retry / purge\n/api/v1" --> Server
    Dev -- "reviews diffs\n/ projects/:slug/builds/:id" --> Server
    Rev -- "approve / reject\nHTMX + server JSX" --> Server

    Server -- "read/write" --> DB
    Server -- "read/write" --> Store
    Server -- "render()" --> Browser
    Browser -- "serve static\nhttp://127.0.0.1:*" --> SB
    Server -- "status checks\nsuccess / failure" --> GH
    Server -- "webhooks\nHMAC SHA-256" --> GH
    GH -- "OAuth / OIDC" --> Server

    classDef external fill:#f6f6f6,stroke:#999,stroke-dasharray: 5 5;
    class GH,Store,DB,Browser,SB external;
```

**Reads as:** the CLI builds/zips Storybook and uploads it (`architecture.md:14`); the server renders asynchronously via Playwright (`architecture.md:17`) without cloning the repo; reviewers approve in the server-rendered UI; the server posts commit statuses back to the git host (ADR 0010). Storage and database are swappable adapters.

---

## 2. Container / Monorepo Package Map (C4 Level 2)

How the monorepo maps to runtime containers. `nub` workspaces are `apps/*` + `packages/*`; `fixtures/*` are isolated `pnpm` installs (`repo-structure.md:8`).

```mermaid
flowchart TB
    subgraph CLI_pkg["CLI — packages/cli"]
        cli["storyshelf\ncommander\nupload / init / create / retry / purge / server init"]
    end

    subgraph Router["HTTP — packages/router"]
        hono["createShelfApp\npackages/router/src/index.tsx:44\nOpenAPIHono"]
        mw["Middleware\nrequestId / requestLogging\ninitGate / rateLimit / csrf\nstoreScope / authGate"]
        routes["Routers\nprojects / builds / snapshots\nlabels / tokens / members\nwebhooks / status-configs / admin\nhealth / media / storybook / ui"]
        pages["Pages + UI\npages/*.tsx (hono/jsx)\nui/DocumentLayout + HTMX\nassets/htmx (vendored)"]
        openapi["OpenAPI\n/api/v1/openapi.json\n/api/v1/docs (Swagger UI)"]
    end

    subgraph Core["Domain — packages/core"]
        adapters["Adapter Interfaces\ncore/adapter/*"]
        models["Models\ncore/models/*\n(constructor-injected)"]
        schema["Schema\ncore/schema/* + ddl.ts"]
        capture["Capture\ncore/capture/*\norchestrator / pipeline / queue\nstorybook discovery"]
        diff["Diff\ncore/diff\npixelmatch + pngjs"]
        retention["Retention\ncore/retention/purge.ts"]
        utils["Utils\ncore/utils + paths + urls\nlogger (pino) + config"]
    end

    subgraph DBadapters["Database Adapters"]
        dbsqlite["@storyshelf/db-sqlite\nnode:sqlite + Drizzle"]
        dbturso["@storyshelf/db-turso\n@libsql/client + Drizzle"]
    end

    subgraph StoreAdapters["Storage Adapters"]
        slocal["@storyshelf/storage-local\nfilesystem"]
        ss3["@storyshelf/storage-s3\nAWS S3 / R2 / MinIO"]
    end

    subgraph AuthAdapters["Auth Adapters"]
        aoauth["@storyshelf/auth-oauth\nOIDC"]
        apw["@storyshelf/auth-password\nshared password"]
    end

    subgraph CaptureAdapters["Capture Adapters"]
        runner["@storyshelf/runner-playwright\npure CaptureRunner"]
        qsqs["@storyshelf/queue-sqs\nSQS CaptureQueue"]
        qmem["InMemoryCaptureQueue\ncore/capture (default)"]
    end

    subgraph GitAdapters["Git Host Adapters"]
        ghub["@storyshelf/git-github\nOctokit"]
        glab["@storyshelf/git-gitlab"]
    end

    subgraph Apps["Apps (deployables)"]
        devsrv["apps/dev-server\nnub run serve (no build)"]
        flyapp["apps/fly-app\nrolldown bundle\nfly.yml"]
        website["apps/website\nAstro Starlight"]
    end

    subgraph Fixtures["Fixtures (not workspaces)"]
        f8["fixtures/storybook-8\nSB 8.6 / :6008"]
        f9["fixtures/storybook-9\nSB 9 / :6009"]
        f10["fixtures/storybook-10\nSB 10 ESM / :6010"]
    end

    cli --> hono
    hono --> mw --> routes --> pages
    hono --> openapi
    routes --> models
    models --> schema
    models --> adapters
    capture --> diff
    capture --> retention
    capture --> runner
    capture --> qmem
    capture -. alternative .-> qsqs
    dbsqlite --> schema
    dbturso --> schema
    slocal --> adapters
    ss3 --> adapters
    aoauth --> adapters
    apw --> adapters
    ghub --> adapters
    glab --> adapters
    devsrv --> hono
    flyapp --> hono
    website -. docs .-> hono
    f8 -. test only .-> runner

    classDef core fill:#e8f0fe,stroke:#4285f4;
    classDef adapter fill:#fef7e0,stroke:#fbbc04;
    classDef app fill:#e6f4ea,stroke:#34a853;
    classDef fixture fill:#f3e8fd,stroke:#9c27b0,stroke-dasharray: 5 5;
    class Core,hono,mw,routes,pages,openapi,capture,diff,retention,models,schema,utils,adapters core;
    class dbsqlite,dbturso,slocal,ss3,aoauth,apw,runner,qsqs,qmem,ghub,glab adapter;
    class devsrv,flyapp,website,cli app;
    class f8,f9,f10 fixture;
```

**Key rules:** primary export first (`repo-structure.md:46`); `core` is HTTP-free (`packages/core/src/index.tsx:1`); HTTP lives only in `router`; bundler rule `tsdown` for libs / `rolldown` for `apps/fly-app` (`repo-structure.md:15`).

---

## 3. Adapter Composition — `createShelfApp`

Every adapter implements `Adapter<Extra>` (`packages/core/src/adapters/metadata.ts:88`) — `metadata { name, version, kind, category }` + optional `lifecycle { init, close, health }`.

```mermaid
flowchart LR
    subgraph Options["ShelfOptions\npackages/core/src/config.ts:146"]
        db["database: DatabaseAdapter"]
        storage["storage: StorageAdapter"]
        runner2["captureRunner?: CaptureRunner"]
        queue["captureQueue?: CaptureQueue"]
        auth["auth?: AuthAdapter"]
        githosts["gitHosts?: GitHostProvider[]"]
        logger["logger?: Logger (pino)"]
        ui["ui?: UIConfig"]
        config["config?: ShelfConfig"]
    end

    createRouter["createShelfApp(options)\npackages/router/src/index.tsx:44"]

    subgraph Runtime["resolveRuntime(options)\npackages/router/src/runtime.ts"]
        cfg["ShelfConfig\nsecret / scratchDir\ncaptureConcurrency\npurgeTtlDays / viewports"]
        uicfg["UIConfig\nname / logo / theme"]
        log2["createShelfLogger()\npackages/core/src/logger.ts"]
    end

    subgraph Lifecycle["Lifecycle\npackages/router/src/lifecycle.ts:44"]
        init["attachLifecycle\nrunAdapterInits (Promise.allSettled)\napp.lifecycle { ready, init(), close() }"]
        gate["initGate middleware\n503 until settled"]
        health["GET /api/v1/health (liveness)\nPOST /api/v1/health (readiness)"]
    end

    subgraph Wiring["Wiring\npackages/router/src/index.tsx:74"]
        mw2["wireMiddleware\nrequestId / requestLogging\nrateLimit / csrf\nstoreScope(AsyncLocalStorage)\nauthGate"]
        qsetup["setupCaptureQueue\npackages/router/src/capture-setup.ts:14\nInMemoryCaptureQueue | SQS"]
    end

    subgraph Routes2["registerAllRoutes"]
        api["registerApiRoutes\nprojects / builds / labels\ntokens / members / webhooks"]
        pages2["registerPageRoutes\nassets / storybook / ui pages\nauth (if configured)"]
        docs["registerDocs\n/api/v1/openapi.json + /docs"]
    end

    Options --> createRouter
    createRouter --> Runtime --> Lifecycle --> Wiring --> Routes2
    qsetup --> Routes2
    Lifecycle --> health

    classDef opts fill:#fef7e0,stroke:#fbbc04;
    classDef router fill:#e8f0fe,stroke:#4285f4;
    class Options opts;
    class createRouter,Runtime,Lifecycle,Wiring,Routes2 router;
```

**Lifecycle:** `createShelfApp` kicks `lifecycle.init` eagerly (`Promise.allSettled`, `packages/router/src/lifecycle.ts:39`); callers `await app.lifecycle.init()` for fail-fast startup (migrations run here) or let first request gate on settlement (503 with per-adapter failures). `close()` on `SIGTERM`. Health is two-tier and ungated by init (`architecture.md:250`).

---

## 4. Request Lifecycle — Middleware Chain

```mermaid
sequenceDiagram
    participant Client
    participant Hono as Hono App
    participant MW as Middleware Stack<br/>packages/router/src/index.tsx:74
    participant Store as AsyncLocalStorage<br/>packages/router/src/store.ts
    participant Handler as Route Handler
    participant Model as Model<br/>packages/core/src/models/*
    participant DB as DatabaseAdapter
    participant Storage as StorageAdapter

    Client->>Hono: Request (HTTP)
    Hono->>MW: requestId()
    MW->>MW: requestLogging(logger) — pino structured
    MW->>MW: initGate(getReady) — 503 if init failed
    MW->>MW: rateLimit (/api/v1/*, 100/min)
    MW->>MW: csrf() (/projects/:slug/settings/*)
    MW->>Store: storeScope({ db, storage, config, ui, logger, authEnabled, enqueueCapture, queue, gitHosts, resolveUser })
    Note over Store: Constructor injection for models<br/>new BuildsModel(db, storage)
    MW->>MW: authGate() — session / token check
    MW->>Handler: c.get('store') → { db, storage, ... }
    Handler->>Model: new XxxModel(db, storage)
    Model->>DB: typed CRUD (eq/and/inArray)
    Model->>Storage: read/write/delete/list
    Handler-->>Client: JSON (/api/v1) or HTML (hono/jsx + HTMX) + HX-Redirect
```

Conventions: IDs are ULIDs, timestamps ISO-8601 (`architecture.md:30`); `linkRoute()` for type-safe URLs; outbound HTTP via `httpJson`/`HttpError` (`core/utils`), never hand-rolled fetch (ADR 0019); structured logs `logger.info({ buildId }, "msg")` with `err` child (ADR 0014).

---

## 5. Capture Pipeline — End-to-End Sequence

Server-side render per ADR 0015 — the CLI never runs Playwright; the renderer is pure (`CaptureRunner.render → Buffer`, `packages/core/src/adapters/capture-runner.ts`).

```mermaid
sequenceDiagram
    participant CI as CI / Developer
    participant CLI as storyshelf CLI<br/>packages/cli/src/commands/upload.ts
    participant API as POST /api/v1/projects/:id/builds<br/>packages/router/src/routers/builds.ts
    participant Q as CaptureQueue<br/>core/capture / queue-sqs
    participant Orc as Orchestrator<br/>core/capture/orchestrator.ts:32
    participant FS as StorageAdapter<br/>local / S3
    participant Runner as CaptureRunner<br/>runner-playwright
    participant Diff as Diff Engine<br/>core/diff (pixelmatch)
    participant Git as GitHostProvider

    CI->>CLI: storyshelf upload --token=xxx
    CLI->>CLI: build Storybook (if needed) → zip
    CLI->>CLI: git tag --points-at SHA → persistent labels
    CLI->>API: multipart: zip + { sha, branch, message, author, labels }
    API->>FS: storage.write(projectId/builds/buildId/storybook.zip)
    API->>API: BuildModel.create(status=pending)
    API->>Q: enqueue({ buildId, reqId })
    API-->>CLI: 202 Accepted { buildId, status: pending }

    Q->>Orc: dequeue → executeCaptureJob({ buildId })

    Orc->>Orc: BuildModel.get + ProjectModel.get
    Orc->>DB: builds.setStatus(capturing)
    Orc->>FS: extractStorybookToScratch(storage, scratchDir, projectId, buildId)
    Note over Orc,FS: path-traversal protection + scratchDir<br/>packages/core/src/config.ts:53
    Orc->>FS: persistStorybookStatics(scratchDir → storage storybook/buildId/)
    Orc->>Orc: StorybookAdapter.discover(scratchDir) → StoryEntry[]
    Orc->>Orc: filter !isDisabledStory, resolve viewports (DEFAULT_VIEWPORTS)
    Orc->>Runner: render({ buildId, storybookDir, stories, viewports, logger, executePlay, playTimeoutMs })

    rect rgb(240, 248, 255)
        Note over Runner: Pure renderer — no DB/storage access
        Runner->>Runner: serveStatic(storybookDir) → http://127.0.0.1:*
        Runner->>Runner: chromium.launch() (pinned image)
        loop story × viewport
            Runner->>Runner: page.goto(buildUrl(origin, story.id))
            Runner->>Runner: waitForReady(page) + networkidle
            Runner->>Runner: optional play() execution
            Runner->>Runner: locator(#storybook-root).screenshot(animations: disabled)
        end
        Runner-->>Orc: { captures: RenderedSnapshot[], failures: { storyId }[] }
        Runner->>Runner: browser.close() + server.close()
    end

    Orc->>Orc: partition failures → blockingFailed vs flakyFailed (isFlakyStory)
    Orc->>Diff: persistCapture({ db, storage, project, build, viewports, captures })
    Diff->>FS: storage.read(baseline) — per-branch fallback
    Diff->>Diff: diffImages(baseline, current, { pixelThreshold, maxDiffRatio })
    Diff->>FS: storage.write(screenshots/{story}/{viewport}.png)
    Diff->>FS: storage.write(diffs/{story}/{viewport}.png) if changed
    Diff->>DB: snapshots upsert (status: new/unchanged/changed)
    Diff->>DB: builds update (snapshot_count, changed_count, status)

    alt blocking failures present
        Orc->>DB: builds.setStatus(failed)
    else if new/changed present
        Orc->>DB: builds.setStatus(reviewing)
    else
        Orc->>DB: builds.setStatus(approved) — default branch auto-approve
        Orc->>FS: copy screenshot → baselines/{branch}/{story}/{viewport}.png
        Orc->>DB: baselines upsert
    end

    Orc->>Git: setCommitStatus(sha, success/failure/pending, storyshelf/project-name)
    Orc->>Git: sendWebhooks(project webhooks, events)
    Orc->>Orc: scratchDir cleanup
```

**Performance note:** v1 re-renders every story (`architecture.md:797` deferred TurboSnap); viewport concurrency is runner-internal; queue concurrency defaults to 2 (`ShelfConfig.captureConcurrency`).

---

## 6. Baseline Resolution & Review Workflow

### 6a. Baseline Resolution (per-branch fallback, ADR 0009)

```mermaid
flowchart TB
    start(["Snapshot (story, viewport)<br/>in build on branch B"])
    lookupB{"baselines<br/>(project, story, viewport,<br/>branch = B) exists?"}
    lookupDefault{"baselines<br/>(project, story, viewport,<br/>branch = default) exists?"}
    isDefault{"B == default branch?"}
    diffBranch["Diff against branch B baseline"]
    diffDefault["Diff against default baseline<br/>(fallback)"]
    newDefault["No baseline — brand new story"]
    autoApprove["Auto-approve<br/>write baseline for default"]
    markNew["Mark snapshot = new<br/>(needs review)"]
    unchanged{"diffRatio <= maxDiffRatio<br/>AND pixelThreshold pass?"}
    sizeChanged{"failOnSizeChange<br/>AND dimensions differ?"}
    statusChanged["status = changed<br/>diff overlay in red @ 50% opacity"]
    statusUnchanged["status = unchanged<br/>(auto-approved)"]

    start --> lookupB
    lookupB -- yes --> diffBranch --> unchanged
    lookupB -- no --> lookupDefault
    lookupDefault -- yes --> diffDefault --> unchanged
    lookupDefault -- no --> isDefault
    isDefault -- yes --> newDefault --> autoApprove
    isDefault -- no --> markNew

    unchanged -- yes --> statusUnchanged
    unchanged -- no --> sizeChanged
    sizeChanged -- yes (and failOnSizeChange) --> statusChanged
    sizeChanged -- no --> statusChanged

    classDef decision fill:#fff4ce,stroke:#e6a800;
    classDef action fill:#e8f0fe,stroke:#4285f4;
    classDef terminal fill:#e6f4ea,stroke:#34a853;
    class lookupB,lookupDefault,isDefault,unchanged,sizeChanged decision;
    class diffBranch,diffDefault,newDefault,markNew action;
    class autoApprove,statusChanged,statusUnchanged terminal;
```

Accepting a diff on feature branch writes `baselines(branch=B)` so subsequent commits on `B` diff against the accepted version, not the untouched default (`architecture.md:371`).

### 6b. Build & Snapshot State Machine

```mermaid
stateDiagram-v2
    [*] --> pending: POST /builds (202)
    pending --> capturing: queue dequeue
    capturing --> comparing: render done
    comparing --> reviewing: persistCapture — new/changed present
    comparing --> approved: all unchanged OR default-branch auto-approve
    comparing --> failed: blocking play failure OR infra error
    reviewing --> approved: approve / approve-all → baselines updated
    reviewing --> rejected: reject / reject-all
    reviewing --> failed: retry exhausted
    approved --> [*]
    rejected --> [*]
    failed --> pending: POST /builds/:id/retry

    state snapshots {
        [*] --> pending2: created
        pending2 --> new: no baseline on feature branch
        pending2 --> unchanged: within threshold
        pending2 --> changed: exceeds threshold
        new --> approved2: accept → copy to baselines/{branch}/
        changed --> approved2: accept
        new --> rejected2: reject
        changed --> rejected2: reject
        approved2 --> [*]
        rejected2 --> [*]
    }
```

Snapshot `status` values (`architecture.md:81`): `pending|new|unchanged|changed|approved|rejected`. Build `status` (`architecture.md:55`): `pending|capturing|comparing|reviewing|approved|rejected|failed`.

---

## 7. Entity-Relationship Model

Derived from `architecture.md:31-181` and `packages/core/src/schema/*`. All PKs are ULIDs; timestamps ISO-8601.

```mermaid
erDiagram
    projects ||--o{ builds : "1 project = 1 Storybook"
    builds ||--o{ snapshots : contains
    projects ||--o{ baselines : "per (story, viewport, branch)"
    projects ||--o{ label_types : defines
    builds ||--o{ build_labels : carries
    label_types ||--o{ build_labels : typed_by
    projects ||--o{ tokens : authenticates
    projects ||--o{ webhooks : notifies
    projects ||--o{ project_members : authorizes
    users ||--o{ project_members : has_role_on
    builds ||--o{ comments : threads_on
    snapshots ||--o{ comments : threads_on
    users ||--o{ comments : authors
    comments ||--o{ comments : replies_to

    projects {
        text id PK "ULID"
        text slug UK "human URL"
        text name
        text git_repository "owner/repo"
        text git_default_branch "default main"
        real pixel_threshold "0-1, default 0.1"
        real max_diff_ratio "0-1, default 0.01"
        text public_branch_regex
        text created_at
        text updated_at
    }
    builds {
        text id PK "ULID (not SHA)"
        text project_id FK
        text git_sha
        text git_branch
        boolean is_default
        text author_email
        text author_name
        text message
        boolean public
        text status "pending|capturing|comparing|reviewing|approved|rejected|failed"
        int snapshot_count
        int changed_count
        int approved_count
        int rejected_count
        text created_at
        text updated_at
    }
    snapshots {
        text id PK
        text project_id FK
        text build_id FK
        text story_id "components-button--primary"
        text story_name
        text story_title "Components/Button"
        text story_import_path
        text viewport_name "default desktop"
        int viewport_width "default 1280"
        int viewport_height "default 720"
        text screenshot_path
        text diff_path
        int diff_pixels
        real diff_ratio
        boolean diff_passed
        text status "pending|new|unchanged|changed|approved|rejected"
        text reviewed_by
        text reviewed_at
        text created_at
        text updated_at
    }
    baselines {
        text id PK
        text project_id FK
        text story_id
        text viewport_name
        text branch "main / feature/xyz"
        text snapshot_id "informational, may be purged"
        text screenshot_path "canonical file"
        text created_at
        text updated_at
    }
    label_types {
        text id PK
        text project_id FK
        text key "branch/persistent/pr/mr/jira/..."
        text name
        text link_template "https://github.com/{repo}/pull/{value}"
        text color
        text created_at
    }
    build_labels {
        text id PK
        text project_id FK
        text build_id FK
        text type_key "→ label_types.key"
        text value "123 / v1.2.3 / feature/foo"
        text created_at
    }
    tokens {
        text id PK
        text project_id FK
        text name
        text hash "SHA-256, unique"
        text last_used_at
        text created_at
    }
    webhooks {
        text id PK
        text project_id FK
        text url
        text secret_encrypted "AES-256-GCM with SECRET"
        text events "JSON array or null=all"
        text created_at
        text updated_at
    }
    users {
        text id PK "from auth provider"
        text email UK
        text name
        text avatar_url
        text role "admin|member"
        text last_login_at
        text created_at
    }
    project_members {
        text id PK
        text project_id FK
        text user_id FK
        text role "admin|approver|developer|viewer"
        text created_at
    }
    comments {
        text id PK
        text project_id FK
        text build_id FK
        text snapshot_id FK "null = build-level"
        text user_id FK "null = anonymous"
        text body
        text parent_id FK "null = top-level"
        boolean resolved
        text created_at
        text updated_at
    }
```

**Invariants:**
* `UNIQUE(build_id, story_id, viewport_name)` on snapshots; `UNIQUE(project_id, story_id, viewport_name, branch)` on baselines; `UNIQUE(project_id, user_id)` on members; `UNIQUE(build_id, type_key, value)` on build_labels.
* Baselines store canonical files — builds are transient and purged without losing truth (`architecture.md:225`).
* `persistent` label type is built-in, non-removable; `branch` is seeded; `build` is reserved (`architecture.md:488`).

---

## 8. Storage Layout

`--data-dir` (default `./data`) is a flat path namespace (`read/write/delete/exists/list`) — no container abstraction (`architecture.md:221`).

```mermaid
flowchart TB
    subgraph DataDir["data/  (--data-dir, default ./data)"]
        subgraph Project["{projectId}/"]
            subgraph Builds["builds/{buildId}/"]
                Screenshots["screenshots/{storyId}/{viewport}.png<br/><em>transient — TTL'd</em>"]
                Diffs["diffs/{storyId}/{viewport}.png<br/><em>transient — TTL'd</em>"]
                SB2["storybook/<br/>index.json + static/<br/><em>published Storybook — served as browsable site</em>"]
                Zip["storybook.zip<br/><em>uploaded archive (optional inline-extract)</em>"]
            end
            subgraph Baselines["baselines/{branch}/{storyId}/{viewport}.png<br/><em>canonical — default branch NEVER purged; stale feature branches TTL'd (30d daily GC)</em>"]
                BMain["main/..."]
                BFeat["feature/xyz/..."]
            end
        end
    end

    Purge[/"Retention Purge<br/>packages/core/src/retention/purge.ts:30<br/>removes builds/* + stale branch baselines/*"/]
    BranchGC[/"Branch GC<br/>packages/core/src/retention/purge.ts:107<br/>purgeStaleBranches + retention-timer.ts daily"/]
    Publish[/"Published Storybook<br/>most recent public build<br/>per project (architecture.md:471)"/]

    Builds -. TTL + keep-latest-per-branch .-> Purge
    Baselines -. stale branches TTL'd .-> BranchGC
    SB2 -. served at .-> Publish

    classDef transient fill:#fef7e0,stroke:#fbbc04;
    classDef canonical fill:#e6f4ea,stroke:#34a853;
    classDef purge fill:#fce8e6,stroke:#ea4335;
    class Screenshots,Diffs,Zip transient;
    class BMain,BFeat,Baselines,SB2 canonical;
    class Purge,Publish purge;
```

Upload path: CLI uploads `storybook.zip` → storage; orchestrator extracts to `scratchDir` (temp), then `persistStorybookStatics` copies to `storage/{projectId}/builds/{buildId}/storybook/` for serving (`packages/core/src/capture/orchestrator.ts:57`). `maxInlineUnzipSize` controls inline extraction at upload.

---

## 9. URL Model & Published Storybook

```mermaid
flowchart LR
    subgraph PublicAPI["JSON — /api/v1 (ULID ids)"]
        api1["GET /api/v1/projects"]
        api2["POST /api/v1/projects/:projectId/builds → 202"]
        api3["GET /api/v1/projects/:projectId/builds/:buildId/snapshots"]
        api4["POST .../snapshots/:id/approve"]
        api5["... /tokens /members /webhooks /admin/purge"]
    end

    subgraph HTML["HTML — / (slug ids)"]
        h1["GET / → projects list"]
        h2["GET /projects/:slug/builds/:buildId<br/>review page (diff + comments)"]
        h3["GET /projects/:slug/labels/:key/:value<br/>wildcard value, encodeURI"]
        h4["GET /projects/:slug/settings"]
    end

    subgraph Published["Published Storybook"]
        p1["GET /projects/:slug/storybook<br/>latest on default branch → 302"]
        p2["GET /projects/:slug/storybook/:key/:value<br/>latest bearing label → 302"]
        p3["GET /projects/:slug/storybook/build/:buildId/...<br/>canonical — serves assets"]
        sub["subdomain (optional)<br/>:slug.stories.example.com → default<br/>:buildId.:slug.stories.example.com → specific<br/>via publishedBaseDomain"]
    end

    PublicAPI -. same router .-> HTML
    HTML -. iframe .-> Published
    p1 --> p3
    p2 --> p3
    sub -. alternative .-> p3

    classDef api fill:#e8f0fe,stroke:#4285f4;
    classDef html fill:#fef7e0,stroke:#fbbc04;
    classDef pub fill:#e6f4ea,stroke:#34a853;
    class api1,api2,api3,api4,api5 api;
    class h1,h2,h3,h4 html;
    class p1,p2,p3,sub pub;
```

* HTML and published routes use `slug`; JSON uses ULID (`architecture.md:507`).
* `/storybook` and `/storybook/:key/:value` are resolvers (302) — assets served only under `/storybook/build/:buildId/...` to avoid `key/value` vs `assets/foo.js` collision (`architecture.md:477`).
* `public` = `builds.public` OR `branch` matches `projects.public_branch_regex`; otherwise auth + `viewer` membership required (ADR 0011).
* `linkRoute()` switches between path and subdomain forms based on `publishedBaseDomain`.

---

## 10. Labels — Typed Build Metadata

```mermaid
flowchart TB
    subgraph Types["label_types (per project)"]
        T1["key: branch (seeded)"]
        T2["key: persistent (built-in, non-removable)"]
        T3["key: pr → https://github.com/{repo}/pull/{value}"]
        T4["key: mr → https://gitlab.com/{repo}/-/merge_requests/{value}"]
        T5["key: jira → https://myorg.atlassian.net/browse/{value}"]
        T6["key: custom (auto-created)"]
    end

    subgraph BuildLabels["build_labels rows"]
        L1["(buildId, type_key=branch, value=feature/foo)"]
        L2["(buildId, type_key=pr, value=123)"]
        L3["(buildId, type_key=persistent, value=v1.2.3)"]
    end

    subgraph CLI2["CLI attach"]
        C1["--label key=value (repeatable)"]
        C2["always branch=<git_branch>"]
        C3["git tag --points-at SHA → persistent per tag"]
    end

    subgraph Query["Query & URLs"]
        Q1["GET /builds?label=pr:123"]
        Q2["GET /projects/:slug/labels/:key/:value<br/>lists builds, external link"]
        Q3["GET /projects/:slug/storybook/:key/:value<br/>resolve latest build for label"]
        note["Values encodeURI, wildcard segment<br/>feature/foo → .../branch/feature/foo<br/>not slugified (avoid collision)"]
    end

    Types --> BuildLabels
    CLI2 --> BuildLabels
    BuildLabels --> Query
    note -. explains .-> Query
```

`build` is a reserved type key (route collision); latest build for `(key, value)` is an indexed join over `build_labels` → `builds`, no denormalized pointer (`architecture.md:502`).

---

## 11. Retention & Purge

```mermaid
flowchart TB
    startP(["Trigger<br/>--purge-interval (hourly) + branchGcIntervalMs (daily)<br/>or POST /api/v1/admin/purge<br/>or storyshelf purge CLI"])
    loadProjects["For each project"]
    cutoff["cutoff = now - purgeTtlDays (30)"]
    candidates["candidates = builds<br/>where status IN (approved,rejected)<br/>AND updated_at < cutoff"]
    keepLatest{"keepLatestPerBranch?<br/>(default true)"}
    latest["latestPerBranch = most recent build<br/>per git_branch<br/>packages/core/src/retention/purge.ts:74"]
    checkPersistent{"hasPersistent? (LabelModel)<br/>+ in keep set?"}
    skip["skip — retain"]
    toPurge["buildIds to purge"]
    delFiles["storage.list(prefix)<br/>storage.delete(each file)<br/>prefix = {projectId}/builds/{buildId}/"]
    delRows["BuildModel.remove(buildId)<br/>cascades snapshots + comments"]
    orphanGC["Orphan baseline GC<br/>(default-branch builds only)<br/>diff index.json vs baselines table<br/>delete story_id no longer in Storybook"]
    branchGC["Branch GC<br/>purgeStaleBranches(project, branchTtlDays=30)<br/>branches with no build since cutoff<br/>default branch exempt"]
    done(["Done<br/>return { removedBuilds, removedBranches, removedBaselines }"])

    startP --> loadProjects --> cutoff --> candidates --> keepLatest
    keepLatest -- yes --> latest --> checkPersistent
    keepLatest -- no --> checkPersistent
    checkPersistent -- yes --> skip
    checkPersistent -- no --> toPurge --> delFiles --> delRows --> orphanGC --> branchGC --> done
    skip --> orphanGC
    orphanGC --> branchGC

    classDef trigger fill:#e8f0fe,stroke:#4285f4;
    classDef decision fill:#fff4ce,stroke:#e6a800;
    classDef action fill:#fef7e0,stroke:#fbbc04;
    classDef done2 fill:#e6f4ea,stroke:#34a853;
    class startP trigger;
    class keepLatest,checkPersistent decision;
    class loadProjects,cutoff,candidates,latest,toPurge,delFiles,delRows,orphanGC,branchGC action;
    class done done2;
```

Never purged: `baselines/**` + builds with `persistent` label (`architecture.md:440`). Builds in non-terminal `reviewing` are not candidates.

---

## 12. Lifecycle & Health Probes

```mermaid
flowchart TB
    subgraph Init["Startup — packages/router/src/lifecycle.ts:33"]
        kick["kickInit() — runAdapterInits(collectInits(options))<br/>Promise.allSettled, never rejects"]
        cell["LifecycleCell { ready: Promise, settled: AdapterInitResult|null }"]
        awaitInit["await app.lifecycle.init()<br/>fail-fast (migrations run here)"]
        gate2["initGate middleware<br/>first request awaits cell.ready<br/>503 + per-adapter failures if !ok"]
        close["app.lifecycle.close()<br/>runAdapterCloses on SIGTERM/SIGINT"]
    end

    subgraph Health["Health — ungated by init"]
        liveness["GET /api/v1/health<br/>open liveness<br/>{ status: ok, uptimeSecs, version }<br/>no adapter I/O — Fly/Docker probe"]
        readiness["POST /api/v1/health<br/>site-admin deep readiness<br/>{ status, adapters: [{ category, kind, name, state, latencyMs, detail }] }<br/>200 or 503, sanitized"]
    end

    kick --> cell --> gate2
    cell --> awaitInit
    cell --> close
    Health -. independent .-> Init

    classDef init fill:#e8f0fe,stroke:#4285f4;
    classDef health fill:#e6f4ea,stroke:#34a853;
    class kick,cell,awaitInit,gate2,close init;
    class liveness,readiness health;
```

---

## 13. Deployment Topologies

### 13a. Local / Docker (recommended, `architecture.md:732`)

```mermaid
flowchart TB
    subgraph Docker["Single Container — mcr.microsoft.com/playwright:v1.63.0-noble"]
        Node["Node 22+ — Hono server<br/>node --experimental-transform-types server.ts"]
        PW["Chromium (Playwright) — in-process capture"]
        SQLite["SQLite — node:sqlite (WAL)<br/>@storyshelf/db-sqlite"]
        FS["Filesystem — @storyshelf/storage-local<br/>VOLUME /app/data"]
        Queue2["InMemoryCaptureQueue<br/>concurrency 2"]
    end

    Compose["docker-compose.yml<br/>ports 3000:3000<br/>env: SECRET, CAPTURE_CONCURRENCY,<br/>PURGE_TTL_DAYS, OIDC_*/AUTH_PASSWORD"]
    CI2["CI — storyshelf upload"]

    CI2 --> Node
    Node --> PW
    Node --> SQLite
    Node --> FS
    Node --> Queue2
    Compose -. defines .-> Docker

    classDef container fill:#e8f0fe,stroke:#4285f4;
    class Docker,Node,PW,SQLite,FS,Queue2 container;
```

No Docker socket mount, no repo cloning; capture runs via the image's own browsers.

### 13b. Serverless / Cloud

```mermaid
flowchart TB
    subgraph Cloud["Cloud Deployment"]
        Edge["Edge — Vercel / Cloudflare Workers<br/>Hono FetchHandler (Web Request/Response)"]
        Turso["Turso — @libsql/client + Drizzle<br/>@storyshelf/db-turso"]
        S3["S3 / R2 — @storyshelf/storage-s3"]
        QRemote["Remote Queue — SQS / Cloudflare Queues<br/>@storyshelf/queue-sqs"]
        Worker["Worker Fleet — polls queue<br/>executeCaptureJob() + @storyshelf/runner-playwright"]
    end

    Edge --> Turso
    Edge --> S3
    Edge --> QRemote --> Worker
    Worker --> Turso
    Worker --> S3

    note2["CaptureQueue interface is Promise-based<br/>so InMemory and remote share the same contract<br/>packages/core/src/adapters/capture-queue.ts:38"]

    classDef cloud fill:#fef7e0,stroke:#fbbc04;
    class Edge,Turso,S3,QRemote,Worker cloud;
```

`createShelfApp` returns a plain `FetchHandler` — works on any runtime; only the in-process queue constrains Node (`architecture.md:247`).

### 13c. Dev (hot-restart from source, no build)

```mermaid
flowchart LR
    Dev2["Developer"]
    Nub["nub watch ./src/server.ts<br/>packages/dev-server"]
    Source["TS Source — customConditions source<br/>packages/*/src/*.ts (no dist/)"]
    Watch["Watches import graph + .env* + tsconfig + package.json<br/>AGENTS.md:18"]
    Server2["Dev Server — http://localhost:3000<br/>local adapters (SQLite + local FS)"]

    Dev2 --> Nub --> Source --> Watch --> Server2
```

Matches StoryBooker pattern; `nubx turbo verify --force` for full check (`AGENTS.md:9`).

---

## 14. Auth & Access Control

```mermaid
flowchart TB
    subgraph NoAuth["Default (no auth)"]
        N1["auth not configured → open API + UI"]
    end

    subgraph Password["Shared Password — @storyshelf/auth-password"]
        P1["AUTH_PASSWORD env var"]
        P2["session cookie (HMAC with SECRET)"]
    end

    subgraph OAuth["OAuth/OIDC — @storyshelf/auth-oauth"]
        O1["OIDC_ISSUER / CLIENT_ID / SECRET"]
        O2["GET /auth/login → provider"]
        O3["GET /auth/callback → create users row"]
        O4["resolveRequestUser() per request"]
    end

    subgraph RBAC["RBAC — packages/core/src/schema/member.ts"]
        R1["users.role = admin (site-wide bypass)"]
        R2["project_members (project, user) → role<br/>admin | approver | developer | viewer"]
        R3["public builds: without auth (public_branch_regex OR builds.public)"]
        R4["private builds: requires auth + viewer membership (ADR 0008, 0011)"]
    end

    NoAuth -. opt .-> RBAC
    Password --> RBAC
    OAuth --> RBAC

    classDef auth fill:#e8f0fe,stroke:#4285f4;
    classDef rbac fill:#e6f4ea,stroke:#34a853;
    class N1,P1,P2,O1,O2,O3,O4 auth;
    class R1,R2,R3,R4 rbac;
```

CLI uses API `tokens` (`hash` SHA-256) separate from user auth; tokens are per-project (`architecture.md:142`).

---

## 15. Diff Engine Detail

```mermaid
flowchart LR
    subgraph Inputs["Inputs"]
        Base["Baseline PNG<br/>baselines/{branch}/..."]
        Curr["Current Screenshot<br/>screenshots/..."]
        Opts["DiffOptions<br/>pixelThreshold (0-1, default 0.1)<br/>maxDiffRatio (0-1, default 0.01)<br/>includeAntialiasing<br/>failOnSizeChange"]
        Proj["Project overrides<br/>pixel_threshold / max_diff_ratio"]
    end

    Engine["diffImages() — core/diff<br/>pngjs decode → pixelmatch compare<br/>per-pixel color distance"]

    subgraph Outputs["DiffResult"]
        Passed["passed: boolean"]
        Pixels["diffPixels / diffRatio"]
        Overlay["diffImage: PNG overlay<br/>unchanged @ 50% opacity<br/>changed in red"]
        Dims["baselineDimensions / currentDimensions<br/>sizeChanged: boolean"]
    end

    FS2["Storage — write diff overlay if changed"]

    Inputs --> Engine --> Outputs --> FS2

    classDef input fill:#fef7e0,stroke:#fbbc04;
    classDef engine fill:#e8f0fe,stroke:#4285f4;
    classDef output fill:#e6f4ea,stroke:#34a853;
    class Base,Curr,Opts,Proj input;
    class Engine engine;
    class Passed,Pixels,Overlay,Dims,FS2 output;
```

Uses same libs Playwright does internally (`architecture.md:424`); overlay stored as `diffs/{story}/{viewport}.png`.

---

## Appendix: Diagram Index & Maintenance

| # | Diagram | Type | Source Entities |
|---|---------|------|----------------|
| 1 | System Context | flowchart | `architecture.md:11` workflow |
| 2 | Package Map | flowchart | `package.json` workspaces, `repo-structure.md` |
| 3 | Adapter Composition | flowchart | `packages/router/src/index.tsx:44`, `core/config.ts:146` |
| 4 | Middleware Chain | sequence | `packages/router/src/index.tsx:74`, `router/middleware/*` |
| 5 | Capture Pipeline | sequence | `core/capture/orchestrator.ts:32`, `runner-playwright` |
| 6 | Baseline Resolution | flowchart | `architecture.md:363`, ADR 0009 |
| 7 | State Machine | stateDiagram | `architecture.md:55,81` |
| 8 | ER Model | erDiagram | `architecture.md:31`, `core/schema/*` |
| 9 | Storage Layout | flowchart | `architecture.md:204`, `core/utils/paths.ts` |
| 10 | URL Model | flowchart | `architecture.md:471`, `core/urls.ts` |
| 11 | Labels | flowchart | `architecture.md:490`, `core/schema/label.ts` |
| 12 | Retention | flowchart | `core/retention/purge.ts:30`, ADR 0009 |
| 13 | Lifecycle/Health | flowchart | `router/lifecycle.ts:33`, `architecture.md:250` |
| 14 | Deployment | flowchart ×3 | `architecture.md:732`, `docs/adr/*` |
| 15 | Auth/RBAC | flowchart | `architecture.md:199`, ADR 0008 |
| 16 | Diff Engine | flowchart | `core/diff`, `architecture.md:405` |

**When to update:**
* New adapter → §2 and §3.
* New entity/column → §8 + `architecture.md:31`.
* Capture flow change → §5 (keep in sync with `core/capture/orchestrator.ts:32`).
* Deployment option → §13.
