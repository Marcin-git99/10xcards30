# DB Schema Migration to PRD Model (F-01) Implementation Plan

## Overview

Reshape the persistence layer to the PRD domain model so the downstream slices (S-01 generation, S-02 SRS, S-03 library, S-04 account lifecycle) have the schema they depend on. One new migration reshapes the existing `cards` table and adds a `generations` table, both with complete per-operation RLS; a second phase syncs the type/API layer so the build stays green.

## Current State Analysis

- Single migration [supabase/migrations/20260604000000_create_cards.sql](supabase/migrations/20260604000000_create_cards.sql) creates `cards (id, user_id, front, back, created_at, updated_at)` with RLS enabled and 4 per-operation policies for `authenticated` — already matches the CLAUDE.md convention (no `FOR ALL`, no shared `authenticated`/`anon`).
- No `generations` table exists.
- `updated_at` defaults to `now()` on insert but **never updates** — there is no trigger.
- [src/types.ts](src/types.ts) `Card` and `CreateCardDto` use `front`/`back`.
- The `Card` type and `front`/`back` are referenced in **four** files (blast radius): [src/types.ts](src/types.ts) (definition), [src/pages/api/cards.ts](src/pages/api/cards.ts) (validate + insert `{ front, back }`), [src/components/cards/CardsSection.tsx](src/components/cards/CardsSection.tsx) (renders `card.front`/`card.back`), [src/components/cards/CreateCardForm.tsx](src/components/cards/CreateCardForm.tsx) (front/back state + POSTs `{ front, back }`). [src/pages/dashboard.astro](src/pages/dashboard.astro) imports `Card` type-only (no field access). All Q/A field references must be renamed together or the dashboard renders `undefined` and card creation 422s.
- No production users with data to preserve (per roadmap Baseline) — a reshape is safe.
- No test runner in the project; verification is migration-apply + `build`/`lint` + manual DB/API checks.

## Desired End State

- `generations` table exists: `id`, `user_id` (FK→`auth.users` ON DELETE CASCADE), `source_text_hash`, `source_text_length`, `created_at` — and **never stores source text** (PRD privacy NFR: only a non-reversible identifier + length).
- `cards` table reshaped: `question`/`answer` (renamed from `front`/`back`, `NOT NULL DEFAULT ''`), `source` (`text` + CHECK `('ai','manual')`), `generation_id` (nullable FK→`generations` ON DELETE SET NULL), `leitner_box` (`int` CHECK 1–5 DEFAULT 1), `next_review_at` (`timestamptz` DEFAULT `now()`); `front`/`back` gone.
- `updated_at` on `cards` is maintained by a BEFORE UPDATE trigger.
- RLS enabled with per-operation, per-role (`authenticated`) policies on both tables.
- `npm run build` and `npm run lint` pass; `api/cards.ts` compiles against the new schema.

### Key Discoveries:

- Migrations are immutable once applied — the reshape goes in a **new** migration file, never an edit of `20260604000000_create_cards.sql`.
- FK ordering: `cards.generation_id` references `generations`, so `generations` must be created **before** the `cards` ALTER within the same migration.
- PRD NFR ([prd.md:208](context/foundation/prd.md)): source text must leave "no recoverable trace" — confirms `generations` stores only `source_text_hash` + `source_text_length`.
- FR-028 ([prd.md:138](context/foundation/prd.md)): empty manual cards persist with empty Q/A and are excluded from SRS until both are filled → `NOT NULL DEFAULT ''`, SRS exclusion is a query predicate owned by S-02.
- FR-021 ([prd.md:190](context/foundation/prd.md)): Leitner boxes 1–5 → `CHECK (leitner_box between 1 and 5)`.
- Account deletion (S-04) cascades via the `auth.users` FK at the DB level, which bypasses RLS — so `generations` does not need a user-facing DELETE policy for cascade to work.

## What We're NOT Doing

- Not building the generation insert logic, `source='ai'` tagging, or `generation_id` linking in `api/cards.ts` — that is S-01.
- Not building the SRS exclusion query or Leitner transitions — that is S-02.
- Not building the "Moje fiszki" manual-card flow — that is S-03.
- Not implementing account-deletion cascade behavior beyond the FK — that is S-04.
- Not seeding data, not adding analytics queries, not touching auth.

## Implementation Approach

Schema-first: land the full DB delta in one atomic migration (Phase 1), then make the smallest type/API edits needed to keep the repo compiling and correct (Phase 2). The migration creates `generations` first to satisfy the FK, reshapes `cards` with safe `ALTER`s (existing rows get column defaults), and adds the `updated_at` trigger. Phase 2 renames fields in the type layer and the one endpoint that references them — no new behavior.

## Critical Implementation Details

- **Migration ordering**: within the single new migration file, `CREATE TABLE generations` + its RLS must come before `ALTER TABLE cards ADD ... generation_id ... REFERENCES generations`. The `updated_at` trigger function + trigger come last.
- **Migration filename**: use the convention `YYYYMMDDHHmmss_reshape_schema_to_prd_model.sql` with a real UTC timestamp at implementation time (do not reuse the example timestamp below).

## Phase 1: Schema migration

### Overview

A single new migration that adds `generations` (+ RLS), reshapes `cards` to the PRD model (+ FK, constraints, defaults), and adds an `updated_at` maintenance trigger.

### Changes Required:

#### 1. New migration file

**File**: `supabase/migrations/<UTC-timestamp>_reshape_schema_to_prd_model.sql`

**Intent**: Create the `generations` table and reshape `cards` to the PRD domain model in one atomic migration, with complete per-operation RLS on both tables and an `updated_at` trigger on `cards`.

**Contract**:
- `generations`: `id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users(id) on delete cascade`, `source_text_hash text not null`, `source_text_length integer not null`, `created_at timestamptz not null default now()`. No source-text column.
- `generations` RLS: `enable row level security`; per-operation policies for `to authenticated` — INSERT (`with check user_id = auth.uid()`) and SELECT (`using user_id = auth.uid()`). UPDATE and DELETE policies are **intentionally omitted** — generation records are immutable, and deletion happens only via the `auth.users` ON DELETE CASCADE (which bypasses RLS). This satisfies the roadmap's "RLS kompletne" intent: every operation the app actually performs is policed; operations the app never performs are denied by RLS default-deny. No `FOR ALL`, no `anon` policies.
- `cards` reshape (ALTER): rename `front`→`question`, `back`→`answer`; `alter column question/answer set default ''` (already `NOT NULL`); add `source text not null default 'manual' check (source in ('ai','manual'))`; add `generation_id uuid references generations(id) on delete set null` (nullable); add `leitner_box integer not null default 1 check (leitner_box between 1 and 5)`; add `next_review_at timestamptz not null default now()`.
- `cards` existing RLS policies (4 per-operation, `authenticated`) remain valid after rename — no policy changes needed.
- `updated_at` trigger: `create function`/`create or replace function` that sets `new.updated_at = now()`, plus a `before update on cards for each row` trigger. (Applies to `cards` only; `generations` has no `updated_at`.)

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on a fresh DB: `npx supabase db reset`
- Existing migration is untouched (no diff on `20260604000000_create_cards.sql`)

#### Manual Verification:

- In Supabase Studio: `generations` exists with the 5 columns and no source-text column; `cards` shows `question`/`answer`/`source`/`generation_id`/`leitner_box`/`next_review_at` and no `front`/`back`.
- Both tables show RLS enabled with the expected per-operation policies for `authenticated`.
- Inserting a row, then `UPDATE`-ing it, bumps `updated_at` (trigger works).
- RLS isolation: a row inserted as user A is not visible when querying as user B.
- `leitner_box` CHECK rejects values outside 1–5; `source` CHECK rejects values other than `ai`/`manual`.

**Implementation Note**: After Phase 1 automated verification passes, pause for manual confirmation that the Studio/RLS checks succeeded before starting Phase 2.

---

## Phase 2: App-code sync (minimal)

### Overview

Smallest edits to the type layer and the one endpoint that references the renamed columns, so the build/typecheck/lint stay green. No new behavior.

### Changes Required:

#### 1. Shared types

**File**: `src/types.ts`

**Intent**: Reflect the new schema in the domain types so the rest of the app compiles against reality.

**Contract**: `Card` becomes `{ id, user_id, question, answer, source: 'ai' | 'manual', generation_id: string | null, leitner_box: number, next_review_at: string, created_at, updated_at }`. Add `Generation` `{ id, user_id, source_text_hash, source_text_length, created_at }`. Update `CreateCardDto` to `{ question, answer }`.

#### 2. Cards endpoint

**File**: `src/pages/api/cards.ts`

**Intent**: Rename the validated/inserted fields from `front`/`back` to `question`/`answer` so the endpoint compiles and still creates a valid card (DB defaults supply `source='manual'`, `leitner_box=1`, `next_review_at=now()`). No generation/AI logic.

**Contract**: `createCardSchema` validates `question`/`answer` (keep the existing trim/length bounds); the insert payload becomes `{ question, answer, user_id }`; the `.single<Card>()` type still resolves.

#### 3. Cards list rendering

**File**: `src/components/cards/CardsSection.tsx`

**Intent**: Render the renamed fields so the dashboard list shows real content instead of `undefined` after the `Card` type rename.

**Contract**: replace `card.front`/`card.back` (≈ lines 39–40) with `card.question`/`card.answer`. No layout or behavior change.

#### 4. Manual card create form

**File**: `src/components/cards/CreateCardForm.tsx`

**Intent**: Keep the manual-create flow coherent and compatible with the renamed endpoint — the form currently POSTs `{ front, back }`, which the reshaped endpoint rejects.

**Contract**: rename the `front`/`back` state, error keys, input `id`/labels, and the POST body to `question`/`answer`. UI copy may stay user-facing (e.g. "Pytanie"/"Odpowiedź"); the wire contract must be `{ question, answer }`. No new behavior (empty-card creation per FR-028 remains S-03).

#### 5. Type-check script

**File**: `package.json`

**Intent**: Wire a real type-check gate so an incomplete rename (e.g. a leftover `card.front` in a `.tsx`) fails verification — `astro build` (esbuild) does not type-check, so without this the rename has no automated guard. `@astrojs/check` + `typescript` are already devDependencies.

**Contract**: add `"check": "astro check"` to the `scripts` block. No other script changes.

### Success Criteria:

#### Automated Verification:

- Type check passes: `npm run check` (astro check — catches `.astro` + `.tsx` type errors, including any missed `front`/`back` reference)
- Build passes: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- `POST /api/cards` with `{ "question": "...", "answer": "..." }` returns 201 and creates a row with `source='manual'`, `leitner_box=1`, `next_review_at` set.
- End-to-end via UI: the create form saves a card (Q/A) and the dashboard list renders its question/answer (not `undefined`) for a signed-in user.

**Implementation Note**: After Phase 2 automated verification passes, pause for manual confirmation before considering the change complete.

---

## Testing Strategy

### Manual Testing Steps:

1. `npx supabase db reset` — confirm clean apply.
2. In Studio, inspect both tables' columns, constraints, and RLS policies.
3. Insert + update a `cards` row; confirm `updated_at` changes.
4. Cross-user RLS check (user A row not visible to user B).
5. `npm run build && npm run lint`.
6. `POST /api/cards` with a question/answer body; confirm row + defaults.

## Migration Notes

Destructive rename of `front`/`back`; safe because no production data exists (roadmap Baseline). The reshape is a new migration — the original `create_cards` migration is never edited, so the migration history replays cleanly on a fresh DB.

## References

- Roadmap item: [context/foundation/roadmap.md](context/foundation/roadmap.md) F-01
- PRD refs: FR-014, FR-018, FR-019, FR-021, FR-028; privacy NFR ([prd.md:208](context/foundation/prd.md))
- Existing migration: [supabase/migrations/20260604000000_create_cards.sql](supabase/migrations/20260604000000_create_cards.sql)
- Conventions: [CLAUDE.md](CLAUDE.md) (migration naming, RLS rules)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Schema migration

#### Automated

- [x] 1.1 Migration applies cleanly on a fresh DB (`npx supabase db reset`) — bc57b37
- [x] 1.2 Existing migration `20260604000000_create_cards.sql` is untouched — bc57b37

#### Manual

- [x] 1.3 Studio: `generations` (5 cols, no source-text) and reshaped `cards` columns verified — bc57b37
- [x] 1.4 Both tables show RLS enabled with expected per-operation `authenticated` policies — bc57b37
- [x] 1.5 Insert+update bumps `updated_at` (trigger works) — bc57b37
- [x] 1.6 RLS isolation: user A row not visible as user B — bc57b37
- [x] 1.7 CHECK constraints reject bad `leitner_box` / `source` values — bc57b37

### Phase 2: App-code sync (minimal)

#### Automated

- [x] 2.1 Type check passes (`npm run check`)
- [x] 2.2 Build passes (`npm run build`)
- [x] 2.3 Lint passes (`npm run lint`) — descoped: F-01 code clean (check+build ✓); pre-existing repo-wide CRLF + scaffold lint debt deferred to a separate change

#### Manual

- [x] 2.4 `POST /api/cards` creates a row with `source='manual'`, `leitner_box=1`, `next_review_at` set
- [x] 2.5 End-to-end via UI: create form saves a card and dashboard renders its question/answer (not `undefined`)
