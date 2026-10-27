# ADR 0037: Portability and Trust in Visual Results

## Status

Proposed. This record sets a direction for follow-up work; existing behavior remains as described
in ADR 0003 and ADR 0009 until changed.

## Context

StoryShelf's purpose is to let teams operate visual regression testing without vendor lock-in.
Adapter choice helps, but it does not by itself guarantee that a team can recover its data or
trust a comparison after its rendering environment changes. Baseline transfer exists today; its
archive can record skipped images. It is not a full instance backup. ADR 0009 also explicitly
accepts that a default-branch environment migration can mask a regression in the same build.

## Proposed direction

1. Treat baseline portability as a user-facing compatibility contract. Document the archive format,
   versioning, supported upgrade paths and the data it excludes. A complete export must preserve
   baseline identity, image bytes and available comparison metadata. Incomplete exports must be
   unmistakably identified to the caller; an import must not silently claim a complete restore.
2. Define and test a separate instance recovery procedure covering the database, object storage,
   configuration and secrets required to restore access. State consistency and downtime
   requirements, version compatibility, and what is deliberately excluded. A baseline archive is
   not a substitute for this procedure. Never include credentials in a portable baseline archive.
3. Evaluate new integrations by exit cost as well as ease of setup: the core workflow should be
   operable without a particular cloud, git host or proprietary service. Optional integrations
   must not become the sole route to a user's durable data or review decisions.

## Consequences and alternatives

A portable format and recovery test add maintenance and compatibility obligations. Adapter interfaces alone do not demonstrate recovery or data portability. Environment migration
is addressed separately in ADR 0038.

## Open questions

- Which metadata is essential for a useful baseline transfer, and how should older archives be
  interpreted? What operational consistency mechanism is practical for each supported backend?
