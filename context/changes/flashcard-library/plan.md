# Flashcard Library (S-03) Implementation Plan

## Overview

Build the "Moje fiszki" screen: a dedicated `/library` route where a signed-in user sees all their cards (AI + manual) sorted `created_at` desc, edits Q and/or A in place, deletes a card with confirmation, and creates an empty card manually via **[+ Nowa fiszka]**. Covers US-07 and FR-023 (list view), FR-024 (manual create), FR-025 (delete with confirmation), FR-026 / BR-3 (edit Q/A must NOT touch `leitner_box` / `next_review_at`), FR-028 (manual card excluded from SRS until both Q and A are filled). Prerequisite F-01 is done — the `cards` schema (`question`, `answer`, `source`, `generation_id`, `leitner_box`, `next_review_at`) and its per-operation RLS policies already exist.

## Current State Analysis

- **Schema (F-01, done):** `cards` has `id, user_id, question, answer, source('ai'|'manual'), generation_id (nullable FK), leitner_box int, next_review_at timestamptz, created_at, updated_at` (confirmed in `src/types.ts:1-12`). RLS has per-operation policies for insert/select/update/delete on the `authenticated` role keyed on `user_id = auth.uid()`.
- **API:** `src/pages/api/cards.ts` exposes only `POST` — creates a card from `{question, answer}` (zod-validated, both required, max 500), inserts with `user_id`, returns the row. No `GET`, `PATCH`, or `DELETE`. The POST schema requires non-empty Q and A, so it cannot create an *empty* manual card as-is (FR-024 needs that).
- **Existing cards UI:** `src/components/cards/CardsSection.tsx` + `CreateCardForm.tsx` are mounted on `/dashboard` as a demo. They are read-only display + create; no edit/delete. `CreateCardForm` imports `@/components/auth/FormField` — that `auth/` dir is owned by lane A (F-02) and slated for deletion in F-02 Phase 2. New code in this lane must NOT depend on `src/components/auth/*`.
- **Auth / routing:** `src/middleware.ts` resolves `context.locals.user` on every request and guards `PROTECTED_ROUTES = ["/dashboard"]`. It is owned by lane A — this lane must NOT edit it. `/library` will be guarded at page level via `Astro.locals.user`.
- **Conventions:** Astro SSR (`output: server`), API routes `export const prerender = false` + uppercase verbs + zod validation; per-request Supabase SSR client via `createClient(headers, cookies)` (`src/lib/supabase.ts`); `@/` path alias; `cn()` from `@/lib/utils`; React islands only where interactive; `lucide-react` icons; hand-rolled Tailwind inputs in the "cosmic" dark-glass theme (`@utility bg-cosmic`, white-on-dark, `rounded-xl border border-white/10 bg-white/5`). The only shadcn primitive present is `src/components/ui/button.tsx` (no dialog/input/textarea).
- **Dev port:** this lane runs on 4322 (lane A owns 4321).

## Desired End State

A signed-in user navigates to `/library` and sees a page titled "Moje fiszki" listing every card they own, newest first, each showing question, answer, a source badge (AI / ręczna), and Edytuj / Usuń actions. Editing a card updates only `question` / `answer` and visibly preserves its Leitner position. Deleting prompts for confirmation before removal. **[+ Nowa fiszka]** adds a new empty card that is immediately editable and labelled as excluded from review until both fields are filled. Unauthenticated visitors to `/library` are redirected to `/auth/signin`. Verified by `npm run lint`, `npm run build`, and manual flows on port 4322.

## What We're NOT Doing

- **NOT** editing `src/middleware.ts` (owned by lane A). `/library` is guarded at page level.
- **NOT** editing `src/components/Topbar.astro` (owned by lane A).
- **Post-merge follow-up (explicit, deferred to a separate slice after both lanes land):** add `/library` to `PROTECTED_ROUTES` in `src/middleware.ts`, and add a "Moje fiszki" nav link in `src/components/Topbar.astro`. Until then page-level guard is the safety net and the route is reachable only by typed URL / a temporary link from the dashboard.
- **NOT** adding DB migrations — uses the F-01 schema as-is.
- **NOT** depending on `src/components/auth/*` (FormField etc.) — those belong to lane A and may be deleted by F-02. This lane ships its own field component.
- **NOT** building SRS scheduling logic — this lane only guarantees that edits don't mutate `leitner_box`/`next_review_at` and that incomplete manual cards stay out of the queue. The queue/consumer is S-02's job; we only set the data so S-02 can filter.
- **NOT** touching `/dashboard` or the existing `CardsSection`/`CreateCardForm` demo (left as-is; the library is a separate route).
- **NOT** running `npx supabase stop/start` (owned by lane A).
- **NOT** paginating / searching / filtering the list (PRD MVP is a flat pool; out of scope).

## Implementation Approach

Follow the established server-island split: a thin Astro page (`src/pages/library.astro`) does the page-level auth guard and the initial server-side fetch of the user's cards, then hands them to a single React island (`LibraryView`) that owns all interactivity (edit, delete, create) via `fetch` to an extended `src/pages/api/cards.ts`. The API gains `GET` (list, redundant-safe with the SSR fetch but used after mutations), `PATCH /api/cards/:id` and `DELETE /api/cards/:id` (via a dynamic route file), plus a relaxed create path for empty manual cards. All Supabase access uses the per-request SSR client so RLS enforces ownership — no manual `user_id` filtering needed beyond what RLS already does, though we keep `user_id` on insert.

The single load-bearing rule (FR-026 / BR-3): the PATCH handler updates **only** `question` and `answer` (plus `updated_at`). It never writes `leitner_box` or `next_review_at`. This is enforced by the zod schema shape (it cannot accept those fields) and by the explicit column list in the update.

### Key decisions

- **Manual empty card (FR-024 / FR-028):** create writes `source='manual'`, `question=''`, `answer=''`. "Excluded from SRS until both filled" is a *data* property the SRS consumer (S-02) filters on; this lane guarantees an incomplete card exists with empty Q/A and surfaces a clear "nie wejdzie do powtórek" hint in the UI. We do NOT invent a new `status` column (no migration). Decision recorded as open question Q1 if a sentinel proves necessary.
- **Edit-empties-allowed:** PATCH allows empty strings (a manual card may be saved still incomplete). The create POST currently rejects empty Q/A; we add a separate "create empty manual" path rather than loosening the AI-card contract.
- **New-card SRS defaults:** an empty manual card still needs `leitner_box`/`next_review_at` values to satisfy NOT NULL columns; rely on DB defaults if present, otherwise set `leitner_box=1`, `next_review_at=now()`. Verified against schema during Phase 2 (open question Q2 if columns are NOT NULL without defaults).

## Phase 1: Library route + list view (read) with page-level auth guard

### Overview

Stand up `/library` rendering "Moje fiszki": page-level auth guard, server-side fetch of the user's cards sorted `created_at` desc, and a React island that renders the list (question, answer, source badge) read-only. Add `GET /api/cards` for later client refreshes. No edit/delete/create yet.

### Changes Required:

#### 1. Add `GET` to the cards API

**File:** `src/pages/api/cards.ts`

**Intent:** Return the signed-in user's cards sorted `created_at` desc as JSON, for client-side refresh after mutations (later phases).

**Contract:** `GET /api/cards` → 401 if no `locals.user`; 503 if client null; else `supabase.from("cards").select().order("created_at", { ascending: false })` → `200 [Card, ...]`. Keep `prerender = false`, uppercase export, existing `POST` untouched. RLS scopes rows to the user.

#### 2. Library page (server guard + initial fetch)

**File:** `src/pages/library.astro` (new)

**Intent:** Page-level auth guard and SSR initial data, mirroring `dashboard.astro`'s fetch pattern.

**Contract:** read `Astro.locals.user`; if absent → `return Astro.redirect("/auth/signin")`. Else create SSR client, `select().order("created_at",{ascending:false})`, pass `initialCards` to `<LibraryView client:load />` inside `Layout title="Moje fiszki"`. Cosmic theme wrapper consistent with `dashboard.astro`.

#### 3. Library island (list rendering)

**File:** `src/components/library/LibraryView.tsx` (new)

**Intent:** Client island holding card state and rendering the list read-only this phase.

**Contract:** props `{ initialCards: Card[] }`; `useState` seeded from props; renders heading "Moje fiszki" + count, a `[+ Nowa fiszka]` button (inert placeholder this phase or wired in Phase 3), and a list of cards each showing question, answer, and a source badge ("AI" / "ręczna"). Empty state: "Nie masz jeszcze żadnych fiszek." Uses `cn()`, lucide icons, cosmic styling. No dependency on `src/components/auth/*`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Signed-out visit to `/library` → redirected to `/auth/signin`.
- Signed-in visit to `/library` → "Moje fiszki" renders the user's cards newest-first, each with Q, A, and source badge.
- A user with zero cards sees the empty-state copy.
- `GET /api/cards` returns the same cards as JSON (401 when signed out).

**Implementation Note:** After this phase and automated verification pass, pause for manual confirmation before Phase 2.

---

## Phase 2: Edit & delete (PATCH / DELETE) preserving Leitner state

### Overview

Make cards mutable: edit Q/A in place (PATCH that touches only `question`/`answer`) and delete with a confirmation step. This phase carries the critical BR-3 guarantee.

### Changes Required:

#### 1. Dynamic card endpoint

**File:** `src/pages/api/cards/[id].ts` (new)

**Intent:** Per-card update and delete, ownership-scoped by RLS.

**Contract:**
- `PATCH /api/cards/:id` — body zod-validated to `{ question?: string (max 500), answer?: string (max 500) }`, at least one present; **schema MUST NOT accept `leitner_box`/`next_review_at`/`source`/`generation_id`** (strict object). Update sets only the provided columns + `updated_at = now()`, `.eq("id", id)`, `.select().single()`. 401 / 503 / 404 (no row) / 422 (validation) handled like the existing POST. **Never writes Leitner columns (FR-026 / BR-3).**
- `DELETE /api/cards/:id` — `delete().eq("id", id)`; 401 / 503; 200 on success. RLS ensures only the owner's row is affected.
- `export const prerender = false`.

#### 2. Edit UI in the island

**File:** `src/components/library/LibraryView.tsx` (edit)

**Intent:** Inline edit form per card; on save PATCH and replace the card in state without reordering (preserves list position and visibly preserves Leitner box).

**Contract:** each card has an "Edytuj" toggle revealing Q/A fields (own field component, not auth/FormField) + "Zapisz"/"Anuluj". Save → `PATCH /api/cards/:id` → replace in `useState` list in place. Show validation/server errors inline. Optionally display the card's `leitner_box` so the manual tester can confirm it does not change.

#### 3. Delete UI with confirmation

**File:** `src/components/library/LibraryView.tsx` (edit)

**Intent:** "Usuń" with a confirmation step (FR-025) before calling DELETE.

**Contract:** "Usuń" reveals an inline "Na pewno? [Usuń] [Anuluj]" confirm (no shadcn dialog exists; inline confirm keeps deps minimal — see Q3). Confirm → `DELETE /api/cards/:id` → remove from state. Errors surfaced inline.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Edit a card's Q and/or A → persists after reload; `leitner_box` and `next_review_at` are unchanged (BR-3) — verify via the displayed box and/or DB.
- Delete asks for confirmation; cancelling keeps the card; confirming removes it (gone after reload).
- PATCH with a body containing `leitner_box` is rejected (422) — the schema does not accept it.
- Acting on another user's card id is impossible (RLS → 404/no-op).

**Implementation Note:** Pause for manual confirmation before Phase 3.

---

## Phase 3: Manual create of empty card excluded from SRS

### Overview

Wire **[+ Nowa fiszka]** to create an empty manual card (FR-024) that appears immediately editable and is marked excluded from review until both Q and A are filled (FR-028).

### Changes Required:

#### 1. Empty-manual create path

**File:** `src/pages/api/cards.ts` (edit)

**Intent:** Allow creating a `source='manual'` card with empty `question`/`answer` without loosening the AI-card POST contract.

**Contract:** accept a create-mode discriminator (e.g. body `{ mode: "empty" }` or a dedicated branch) → insert `{ user_id, question: "", answer: "", source: "manual" }` (+ Leitner defaults if columns lack DB defaults — confirm schema, see Q2). Existing full-card POST (`{question, answer}` both required) stays intact for AI/normal create. Return the new row. 401 / 503 handled as today.

#### 2. Create + completeness UI

**File:** `src/components/library/LibraryView.tsx` (edit)

**Intent:** `[+ Nowa fiszka]` creates the empty card, prepends it to the list, opens it in edit mode, and flags incomplete cards.

**Contract:** button → POST empty → prepend to state → auto-enter edit mode. A card with empty `question` or `answer` shows a hint badge "Nie wejdzie do powtórek, dopóki nie wypełnisz pytania i odpowiedzi." (FR-028). Filling both and saving clears the badge.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `[+ Nowa fiszka]` adds an empty, editable card at the top of the list with the "excluded from review" hint.
- The incomplete card persists across reload and still shows the hint until both fields are filled.
- Filling Q and A and saving removes the hint; the card has `source='manual'`.
- The empty manual card never appears as due in an SRS context (data-level: empty Q or A) — verified against the S-02 filter contract or by inspection.

**Implementation Note:** After this phase, S-03 functionality is complete. Update roadmap status; the Topbar nav link + `PROTECTED_ROUTES` entry remain the documented post-merge follow-up.

---

## Testing Strategy

### Unit Tests:

- None — no test runner in the project yet (Module 3 scope). Verification is lint + build + manual flows.

### Manual Testing Steps:

1. Signed-out `/library` → redirect to `/auth/signin`; signed-in → list renders newest-first with source badges.
2. Edit Q/A → persists; confirm `leitner_box`/`next_review_at` unchanged (BR-3).
3. Delete → confirmation required; confirm removes, cancel keeps.
4. `[+ Nowa fiszka]` → empty editable manual card with "excluded from review" hint; fill both → hint clears.
5. Run all flows on `npm run dev -- --port 4322`.

## Performance Considerations

None material — single user-scoped query per page load; mutations are single-row. Flat pool per PRD MVP scale (small / dogfooding).

## Migration Notes

No schema changes — uses F-01 tables `cards` / `generations` and existing RLS. No data migration.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-03)
- Format template: `D:\projekty\10xcards-google-oauth\context\changes\google-oauth-switch\plan.md`
- Existing API pattern: `src/pages/api/cards.ts`
- SSR fetch pattern: `src/pages/dashboard.astro`
- Cookie adapter: `src/lib/supabase.ts`
- Theme tokens: `src/styles/global.css` (`bg-cosmic`)
- Lane rules: `LANE.md`

## Open Questions

> Product-level ambiguities deferred with a sensible default chosen, per LANE instructions.

1. **Q1 — Incomplete-card marker:** "Excluded from SRS until both Q and A filled" (FR-028) is currently inferred from empty `question`/`answer` rather than an explicit `status` column. Default chosen: infer from emptiness (no migration, no new column). Revisit only if S-02's queue filter needs an explicit flag.
2. **Q2 — Leitner defaults on empty create:** whether `leitner_box`/`next_review_at` have DB defaults (so an empty manual insert succeeds) or must be set explicitly. Default chosen: set `leitner_box=1`, `next_review_at=now()` on create if the schema lacks defaults; confirm during Phase 3.
3. **Q3 — Delete confirmation style:** no shadcn dialog primitive exists in the repo. Default chosen: inline "Na pewno?" confirm to avoid adding a dependency this lane doesn't own. Swap to `AlertDialog` if a shared dialog lands later.
4. **Q4 — Reachability before nav link:** Topbar nav link is a post-merge follow-up (lane A owns Topbar). Default chosen: `/library` reachable by URL; optionally add a temporary link from `/dashboard` (this lane owns nothing on the dashboard contract, so left out unless requested).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Library route + list view (read)

#### Automated

- [ ] 1.1 Lint passes: `npm run lint`
- [ ] 1.2 Build passes: `npm run build`

#### Manual

- [ ] 1.3 Signed-out `/library` redirects to `/auth/signin`
- [ ] 1.4 Signed-in `/library` lists cards newest-first with source badges
- [ ] 1.5 Zero-card user sees empty-state copy
- [ ] 1.6 `GET /api/cards` returns cards (401 signed out)

### Phase 2: Edit & delete preserving Leitner state

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 Build passes: `npm run build`

#### Manual

- [ ] 2.3 Edit Q/A persists; leitner_box / next_review_at unchanged (BR-3)
- [ ] 2.4 Delete requires confirmation; cancel keeps, confirm removes
- [ ] 2.5 PATCH rejects leitner_box in body (422)
- [ ] 2.6 Cross-user card id is a no-op (RLS)

### Phase 3: Manual create of empty card excluded from SRS

#### Automated

- [ ] 3.1 Lint passes: `npm run lint`
- [ ] 3.2 Build passes: `npm run build`

#### Manual

- [ ] 3.3 [+ Nowa fiszka] adds empty editable manual card with exclusion hint
- [ ] 3.4 Incomplete card persists with hint across reload
- [ ] 3.5 Filling Q and A clears the hint; source='manual'
- [ ] 3.6 Empty manual card never surfaces as SRS-due (data-level)
