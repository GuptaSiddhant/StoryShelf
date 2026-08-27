# ADR 0001: Adapter Composition Pattern

## Status

Accepted

## Context

StoryShelf needs to support multiple storage backends (local filesystem, S3), database backends (SQLite, Turso), authentication providers (OAuth/OIDC, shared password, or none), capture execution (local runner now, remote workers later), and external integrations (GitHub status checks, GitLab commit statuses). Each concern should be independently swappable without changing the core application logic.

The predecessor project (StoryBooker) used this pattern successfully: `createHonoRouter({ database, storage, auth, compute })` where each adapter is an independent interface.

## Decision

Continue the adapter composition pattern. The router factory accepts a bag of adapters:

```typescript
interface ShelfOptions {
  database: DatabaseAdapter;
  storage: StorageAdapter;
  capture?: CaptureRunner;    // server-side Playwright capture (see ADR 0003)
  auth?: AuthAdapter;
  status?: StatusAdapter;     // GitHub/GitLab PR status checks
  logger?: LoggerAdapter;
  ui?: UIConfig;             // brand identity: name, logo, favicon, theme tokens (fixed UI, not an adapter)
  config?: ShelfConfig;
}
```

Note: the earlier "compute adapter" concept is now the **capture runner** — a fixed pipeline (serve uploaded Storybook → render → diff), not a user-defined shell-job dispatcher (see ADR 0003).

Each adapter is a plain TypeScript interface. Provider packages export factories that return implementations (e.g., `createSqliteDatabase(path)`, `createLocalStorage(dataDir)`).

## Consequences

**Positive:**
- Core application code never imports concrete implementations
- Easy to test with in-memory/mock adapters
- New backends can be added without touching core
- Users can swap SQLite for PostgreSQL by changing one adapter

**Negative:**
- One more layer of indirection
- Adapter interfaces must be designed carefully upfront (changing them is breaking)

## Key Difference from StoryBooker

StoryBooker coupled adapters to `AsyncLocalStorage` -- models called `getStore()` to obtain adapters implicitly. This made models untestable without mocking the store.

**StoryShelf uses constructor injection:** models receive adapters as constructor arguments. The store is optional convenience for router handlers, not a requirement for model logic.

```typescript
// StoryBooker (old pattern)
class BuildsModel {
  constructor() {
    const store = getStore();  // throws if no AsyncLocalStorage context
    this.db = store.database;
  }
}

// StoryShelf (new pattern)
class BuildsModel {
  constructor(private db: DatabaseAdapter, private storage: StorageAdapter) {}
}
```
