# DB Schema Migration to PRD Model (F-01) — Plan Brief

> Full plan: `context/changes/db-schema-mvp/plan.md`

## What & Why

Reshape the persistence layer to the PRD domain model. Today the DB only has a minimal `cards (front, back)` table; every downstream slice (S-01 generation, S-02 SRS, S-03 library, S-04 account lifecycle) needs the real schema — renamed Q/A fields, a `source` tag, a `generation_id` link, Leitner scheduling columns, and a `generations` table that stores only a non-reversible hash of the source text. This foundation unblocks all four slices.

## Starting Point

One migration creates `cards (id, user_id, front, back, created_at, updated_at)` with RLS + 4 per-operation policies. No `generations` table; `updated_at` has no trigger; `types.ts` and `api/cards.ts` reference `front`/`back`. No production data to preserve.

## Desired End State

`generations` exists (hash + length only, never source text). `cards` carries `question`/`answer`, `source` (`ai`/`manual`), nullable `generation_id`, `leitner_box` (1–5), `next_review_at`. Both tables have complete per-operation RLS; `updated_at` is trigger-maintained; the build is green with the type/API layer renamed.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Migration strategy | New ALTER migration | Respects immutability of the applied migration; replays cleanly | Plan |
| `source` type | `text` + CHECK | Easy to evolve in MVP, no enum migration pain | Plan |
| Empty Q/A (FR-028) | `NOT NULL DEFAULT ''` | Empty manual card persists; never-null simplifies app code | Plan |
| `generation_id` ON DELETE | SET NULL | Card is the durable "keeper"; nullable FK | Plan |
| `updated_at` | DB trigger | Correct regardless of write path; closes current gap | Plan |
| App-code sync scope | Minimal (types + compile) | Keep CI green without building S-01 features | Plan |
| Empty-card SRS exclusion | Uniform defaults + query predicate | Simplest schema; exclusion owned by S-02 | Plan |

## Scope

**In scope:** new `generations` table + RLS; `cards` reshape + constraints + FK + `updated_at` trigger; rename in `types.ts` and `api/cards.ts` to compile.

**Out of scope:** AI generation/tagging logic, SRS query/transitions, "Moje fiszki" flow, account-deletion behavior beyond the FK cascade, seeding, analytics.

## Architecture / Approach

Schema-first, one atomic migration: create `generations` first (FK dependency), then `ALTER` `cards`, then the `updated_at` trigger. A second minimal phase renames fields in the type layer and the single endpoint that uses them.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema migration | `generations` + reshaped `cards` + RLS + trigger | FK ordering; ALTER defaults for existing rows |
| 2. App-code sync | `types.ts` + `api/cards.ts` compile against new schema | Missing a `front`/`back` reference → build red |

**Prerequisites:** none (F-01 is ready; local Supabase running for migration apply).
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Assumes no production data — the destructive rename is safe per the roadmap Baseline.
- Local Supabase must be running to verify the migration (`npx supabase db reset`).
- RLS isolation and the `updated_at` trigger are verified manually in Studio (no test runner in the project).

## Success Criteria (Summary)

- Migration applies cleanly on a fresh DB; both tables have the PRD columns, constraints, and per-operation RLS.
- `npm run build` and `npm run lint` pass with the renamed type/API layer.
- A manual `POST /api/cards` creates a valid card using the new DB defaults.
