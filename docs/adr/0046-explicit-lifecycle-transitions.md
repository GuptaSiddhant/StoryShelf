# ADR 0046: Explicit Lifecycle Transitions

## Status

Accepted (owner, 2026-11-08; proposed by the architect). Amends ADR 0006 (cancellation) and ADR 0040
(job queues). It lands before ADR 0044's `skipped` status (#548), so that status is added as rows of
a table rather than as new checks.

## Context

A build's status is a list of eight values (`BUILD_STATUSES` in `packages/core/src/types.ts`). A
job's status is a union of six (`CaptureJobStatus`). Which moves between them are allowed is
written nowhere. The rules are scattered across the writers:

- **One move is enforced.** "`cancelled` is final" is checked at the write: `BuildModel.update`
  and `setStatusAtGeneration` use a conditional update (`updateWhere … status <> 'cancelled'`), so
  a write that races a cancel loses, even across instances. `resetStatus` is the one exit. About 20
  more `status === "cancelled"` checks repeat the rule elsewhere.
- **Nothing else is enforced.** A stale worker, a redelivered job or a late verdict can move
  `approved` back to `capturing`, or `failed` to `reviewing`, and the row accepts it. ADR 0014's
  stale-write problem (#785) is the same class of bug on the git side.
- **Status groups are lists, not rules.** `TERMINAL_BUILD_STATUSES`, `CANCELLABLE_BUILD_STATUSES`
  and the resume and active lists are separate arrays. Adding a status means finding every list and
  every `===` check, and ADR 0044 (`skipped`) and ADR 0045 (cancel superseded builds) are about to
  do exactly that.

Writers come from many places: the capture orchestrator, cancel, retry, review verdicts, publish,
the queue consumer after a lease expiry, and (soon) skip. Each one decides on its own what it may
overwrite. The result is that a build's final status can depend on which write lands last, not on
what happened.

## Decision

1. **One transition table per stored lifecycle, in core.** A pure module per lifecycle, for builds
   `packages/core/src/lifecycle/build-lifecycle.ts`, exports:
   - the allowed moves, as `from → to` pairs, derived from today's writers (the implementing task
     lists every writer and the move it makes; a move no writer makes is not in the table);
   - the **terminal** states, which no ordinary move leaves;
   - the **entry-only** states, which a row is created in and never moved to (ADR 0044's
     `skipped`);
   - the **named exits** from a terminal state, each tied to one operation (`retry` →
     `resetStatus`; a review verdict between `approved` and `rejected`).

   `TERMINAL_BUILD_STATUSES`, `CANCELLABLE_BUILD_STATUSES` and the other status lists are derived
   from the table, not maintained by hand.

2. **Enforced at the one write path, as a compare-and-set.** Every status write goes through the
   model, which writes with `updateWhere(… status IN (<allowed from-states for this to-state>))`,
   plus any fence the write already has (`captureGeneration`). This is the mechanism `cancelled`
   already uses, generalised. It needs no lock and holds across instances. A refused write returns
   the current row and logs at debug, as a refused write on a cancelled build does today. A status
   column is never written by a raw `db.update` outside its model.
3. **A refusal is a normal outcome, not an error.** Callers already handle "the build moved on"
   for `cancelled`. They handle every refusal the same way: the newer state stands. A refusal that
   indicates a bug (a move no writer should attempt) fails its test, not production.
4. **Lifecycles covered.**
   - **Build status:** first, before #548.
   - **Capture job and attempt status** (`queued`, `running`, `exhausting`, `done`, `failed`,
     `cancelled`; attempts `running`, `done`, `failed`, `expired`): the same table form. Lease
     expiry and redelivery are where stale writes come from (ADR 0040).
   - **Build retention state** (`available → deleting`, ADR 0039): already fenced; restated as a
     table for one style, with no change in behaviour.
5. **Not covered.** Snapshot status and review verdicts are derived (the snapshot rollup; the
   newest `build_reviews` row counts), so a transition table would duplicate the derivation.
   ADR 0045's superseded builds are `cancelled` builds with `superseded_by_build_id` set, not a new
   status.
6. **Tests.** One table-driven test per lifecycle checks every `from × to` pair against the model:
   allowed pairs apply, every other pair is refused and leaves the row unchanged. A new status
   fails that test until each of its pairs is decided. The shared database contract suites run it
   against SQLite, PGlite and real Postgres, like ADR 0039's suites.

## Delivery

- One Core-lane task before #548: the build table, the model write path, the derived status lists,
  the pair test, and replacing the scattered `=== "cancelled"` checks that the table now covers.
- A second Core-lane task: the job and attempt tables.
- #548 then adds `skipped` as an entry-only terminal state in the table.

## Consequences

- A build's final status no longer depends on which write lands last.
- Adding a status is one table change plus the decisions the pair test forces.
- Writes that used to succeed silently now refuse. Each one is either a bug the table exposes or a
  move the table must list. The implementing task records which.
- Every status write costs one conditional `UPDATE`, the same as a cancelled-guarded write today.

## Alternatives considered

| Option                                       | Why not                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A state-machine library (for example XState) | Models in-memory actors; our state is a database row written by many instances. A table and a CAS fit.  |
| Check the current status, then write         | A read-then-write race: two writers both read an allowed state. The conditional update closes it.       |
| A status-history table with event sourcing   | More than the problem needs; the current row plus the CAS gives the guarantee. History stays in events. |
| Keep per-call-site checks                    | The status quo: every new status repeats them, and nothing proves the set is complete.                  |
