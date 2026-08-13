---
date: 2026-08-13T22:21:31+02:00
researcher: Claude
git_commit: b8ac23f0b129fbfb1e3cf9af7431390ddc38de43
branch: main
repository: Marcin-git99/10xcards30
topic: "S-01 first-gated-generation — generate flashcards via OpenRouter, review, save"
tags: [research, codebase, generations, openrouter, cloudflare-workers, api]
status: complete
last_updated: 2026-08-13
last_updated_by: Claude
---

# Research: S-01 first-gated-generation

**Date**: 2026-08-13T22:21:31+02:00
**Researcher**: Claude
**Git Commit**: b8ac23f0b129fbfb1e3cf9af7431390ddc38de43
**Branch**: main
**Repository**: Marcin-git99/10xcards30

## Research Question

What exists in the codebase (DB schema, API conventions, secrets handling, frontend
patterns, testing conventions) and in the prior-project OpenRouter reference
(`10x-cards`) that a plan for S-01 — paste text → generate 5 flashcards via LLM →
review/edit/reject → approve → save — needs to account for?

## Summary

Prerequisites (F-01 schema, F-02 Google OAuth) are done. The `generations` table
exists with RLS and is already schema/isolation-tested (structurally proven empty
of source text, proven isolated per-user) — but **zero application code touches it**.
No frontend hook directory, no external-`fetch` pattern, no OpenRouter code exists
yet in this repo. The prior project `10x-cards` has a complete, working reference
implementation to port — but it needs four concrete adaptations for this repo's
constraints (Cloudflare Workers runtime, `astro:env/server` secrets, exact-5-card
requirement, SHA-256 instead of MD5) plus one architectural fix (no module-level
singleton clients). All existing conventions (API route shape, error handling,
Supabase client mocking) are consistent and reusable as-is.

## Detailed Findings

### Database schema (`supabase/migrations/`)

`generations` table (from `20260609211146_reshape_schema_to_prd_model.sql:10-16`):

```sql
create table generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_text_hash text not null,
  source_text_length integer not null,
  created_at timestamptz not null default now()
);
```

No `model`, `generated_count`, `accepted_count`, or status column — anything like
that must be added by S-01's own migration if the plan needs it. Source text is
**never persisted**, only a hash + length (privacy guardrail, enforced structurally).

RLS — INSERT + SELECT only, no UPDATE/DELETE (records are immutable; deletion is
cascade-only from `auth.users`):

```sql
create policy "users can insert their own generations"
  on generations for insert to authenticated with check (user_id = auth.uid());
create policy "users can select their own generations"
  on generations for select to authenticated using (user_id = auth.uid());
```

`cards` table (post-reshape): `question`, `answer`, `source enum('ai','manual')`,
`generation_id uuid references generations(id) on delete set null`,
`leitner_box int 1-5`, `next_review_at timestamptz`, `created_at`, `updated_at`
(trigger-maintained). Full CRUD RLS policies exist (insert/select/update/delete,
all `user_id = auth.uid()`). Indexes: `cards_generation_id_idx`,
`cards_user_id_next_review_at_idx`.

`src/types.ts:1-25` has `Card` and `Generation` interfaces already matching this
schema. No `CreateGenerationDto` exists yet.

**Zero code in `src/` queries or inserts into `generations`** — confirmed by grep.

### API route conventions

Pattern from `src/pages/api/cards.ts` and `src/pages/api/cards/[id].ts` (both full-read):

- `export const prerender = false;` at top of every route file.
- Uppercase verb exports: `export const POST: APIRoute = async (context) => {...}`.
- Auth via `context.locals.user` (middleware-populated, not re-verified in handler)
  → `401` if missing. `[id].ts` factors this into a shared `openGate()` helper
  returning `{ok:false, response} | {ok:true, ...ctx}`.
- Body parsing: `try/catch` around `context.request.json()` → `400` on parse failure.
- Zod validation: `.trim().min().max()` chains; validation failure → **`422`** (not
  `400`) with `z.flattenError(result.error)` as the `error` field.
- Supabase client per-request: `createClient(context.request.headers, context.cookies)`;
  `null` → `503`.
- Error response shape always `{ error: string | ZodFlattenedError }`, JSON,
  `Content-Type: application/json`.
- DB/unexpected errors: `logServerError(context, detail)` from `src/lib/api-error.ts`
  generates a `crypto.randomUUID()` ref, logs `[ref] context` + detail, returns the
  ref for a client-facing `"...Support reference: ${ref}"` message on `500`. Reuse
  this verbatim for OpenRouter call failures/timeouts.
- `[id].ts:60-65` has a small `json(body, status)` helper worth reusing for a new
  endpoint instead of re-writing `new Response(JSON.stringify(...))` each time.

### Secrets (`astro:env/server`)

`astro.config.mjs:23-28`:

```js
env: { schema: {
  SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
  SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
} },
```

A new `OPENROUTER_API_KEY` entry must be added here (same shape). `src/lib/supabase.ts`
imports via `import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server"` and
null-guards before use — mirror this for the OpenRouter client, and inject the key
into the service rather than having the service reach into env itself (also fixes
the reference project's `import.meta.env` coupling).

`.dev.vars` currently has `SUPABASE_URL`/`SUPABASE_KEY` only — add
`OPENROUTER_API_KEY` there (not `.env`; workerd doesn't read `.env`).

### Cloudflare Workers runtime constraints

- **No outbound `fetch()` to an external host exists anywhere in `src/` today** —
  the only `fetch()` calls are the frontend hitting this app's own `/api/cards`.
  The OpenRouter call is the first external HTTP integration in this codebase; no
  existing timeout/AbortController pattern to copy — must be designed fresh.
- `wrangler.jsonc` has no `limits`/`cpu_ms`/timeout config — FR-027's 30s budget
  must be enforced in application code (`AbortController` + `setTimeout`), not
  wrangler config. Both `AbortController` and `setTimeout` are standard Web APIs
  and work fine on Workers — the reference project's retry/backoff/jitter logic
  ports without changes on this front.
- `node:crypto`'s synchronous `createHash('md5')` (used for `source_text_hash` in
  the reference project) is **not safely portable to Workers** — use Web Crypto
  (`crypto.subtle.digest('SHA-256', ...)`, async) instead. Also simply better than
  MD5 for a dedup/integrity hash.

### OpenRouter reference implementation (`D:\Users\Acer\Documents\Al\kurs10xdev\10x-cards`)

Full files read: `src/lib/openrouter.service.ts`, `openrouter.types.ts`,
`generation.service.ts`, `.ai/openrouter-service-implementation-plan.md`,
`src/pages/api/generations.ts`, `src/env.d.ts`, `src/lib/openai.service.ts` (orphan),
`src/lib/logger.ts`.

**Service shape**: `OpenRouterService` class, constructor takes
`{apiKey?, apiUrl?, timeout?, maxRetries?, defaultModel?, defaultModelParameters?}`,
Zod-validates its own config. Public: `sendMessage()`, `setSystemMessage()`,
`setUserMessage()`, `setResponseFormat()`, `setModel()`. Private:
`buildRequestPayload()`, `executeRequest()` (retry loop), `handleHttpError()`,
`calculateBackoff()`, `sleep()`. Stateful builder — new instance per call site in
current usage.

**Request**: `POST https://openrouter.ai/api/v1/chat/completions`,
`Authorization: Bearer <key>`, `HTTP-Referer`/`X-Title` headers (must be changed
from the old project's domain/name or dropped — optional attribution only). Body:
`model`, `messages[]`, `temperature/top_p/frequency_penalty/presence_penalty/max_tokens`,
optional `response_format: {type:"json_schema", json_schema:{name, strict, schema}}`.
Defaults: `openai/gpt-4o-mini`, `temperature:0.7`, `max_tokens:2000`, `timeout:30000ms`,
`maxRetries:3`.

**Error hierarchy**: `OpenRouterError` base → `AuthenticationError` (401, no retry),
`RateLimitError` (429, retries then throws), `NetworkError` (timeout/5xx, retries
then throws), `ValidationError` (bad request/response shape). Backoff:
`min(1000*2^(attempt-1), 8000) + jitter(0-500ms)`, capped 3 attempts by default.

**Malformed-JSON fallback** (`generateFlashcardsWithOpenRouter`, module-level fn):
direct `JSON.parse` first; several defensive reshapes (bare array, `.flashcards`
key, single object, scan-for-any-array-valued-key); regex fallback
(`/\{[\s\S]*"flashcards"[\s\S]*\}/` then `/\[[\s\S]*\]/`) if direct parse throws;
throws `ValidationError` if nothing yields valid cards. Post-parse: filters
cards missing/non-string front/back, hard-truncates to 200/500 chars.

**Orchestration** (`generation.service.ts`): hash source text → call OpenRouter →
measure duration → branch on auth (anonymous: no DB write at all, not applicable
here since S-01 requires auth per F-02) → insert into `generations` → on error,
log to a `generation_error_logs` table (doesn't exist in this repo) and rethrow.
Uses a **module-level singleton Supabase service-role client** instead of the
per-request client passed as a param — flagged as an anti-pattern to fix, not
port; this repo's convention is per-request clients via `context.locals`/
`createClient(...)`.

**Prompt mismatch to resolve in the plan**: the reference system prompt says
_"Wygeneruj od 3 do 10 fiszek w zależności od ilości materiału"_ (3–10 cards,
model-driven count) — **not exactly 5** as S-01's outcome requires. Needs a
prompt + `response_format` schema change (e.g. `minItems:5, maxItems:5` on the
`flashcards` array, and an explicit "generate exactly 5" instruction).

**Input validation**: only at the API route layer in the reference project
(`source_text.min(1000).max(10000)`), not in the service — the service itself
has no length guard. `max_tokens:2000` is the only output-size control.

**Orphan/naming drift (confirmed, do not repeat)**: `src/lib/openai.service.ts`
is dead code (nothing imports it), and `src/env.d.ts` declares `OPENAI_API_KEY`
while the live service reads `OPENROUTER_API_KEY` — untyped drift from an earlier
provider swap. Port only `OPENROUTER_API_KEY`, declare it correctly in
`astro.config.mjs`'s `env.schema`.

**`Logger`** redacts any metadata key containing
`apikey/token/password/secret/authorization/key` (case-insensitive substring)
before logging — worth adopting the same redaction if introducing any logging
beyond the existing `logServerError` correlation-ref pattern.

### Frontend patterns

`CreateCardForm.tsx` (121 lines, full read): plain `useState`, no custom hook, no
react-hook-form. Client validation mirrors server validation but isn't authoritative.
`fetch("/api/cards", {method:"POST", ...})`; on non-ok, disambiguates
`typeof data.error === "string" ? data.error : "Something went wrong"` — a comment
(lines 11-19) references a real past incident where an object was rendered as a
React child and crashed the island. **S-01's review-UI must replicate this
disambiguation** for whatever error shape its new endpoint returns.

`LibraryView.tsx` (303 lines, full read): closest analog to the review step.
Edit-in-place (`editingId` + `draft` state, `PUT` then replace local state **with
the server's response**, not the local draft, because the server trims/normalizes).
Reject/delete uses an inline confirm (`confirmingId`) explicitly instead of
`window.confirm` — not stylable, blocks the thread, unreachable by Playwright.
Per-row `pendingId` disables buttons and swaps label text during in-flight
requests instead of a spinner. All UI text is Polish; raw Tailwind + `cn()`, no
shadcn/ui primitives despite the project having shadcn configured.

`src/components/hooks/` **does not exist** — confirmed via Glob, zero hook files
anywhere in `src/`. S-01 would introduce the first custom hook if one is needed.

### Testing conventions

**Hermetic** (`test/hermetic/`, 7 files): Supabase mocked at the module boundary —
`vi.mock("@/lib/supabase", () => ({ createClient: () => ({ from: () => ({...}) }) }))`
with a top-level `vi.fn()` configured per-case, route module dynamically imported
_after_ the mock, invoked directly with a hand-built `APIContext`. **No fetch-mock
pattern exists anywhere** (`vi.stubGlobal("fetch", ...)`, `msw` — zero hits). S-01
should mock the OpenRouter call the same way: wrap it in a module
(e.g. `src/lib/services/openrouter.ts` or similar) and `vi.mock` that module,
rather than stubbing global `fetch`, to stay consistent with the Supabase
convention already established.

`review-schedule.ts`'s test (`test/hermetic/review-schedule.test.ts`) is the
template for testing any pure generation-parsing/candidate-shaping logic: no
mocks, oracles hand-transcribed from PRD text (not mirrored from implementation
constants), `it.each` boundary tables, injected clock/`now` parameter.

**Integration** (`test/integration/`, hits real Supabase, no mocking):
`generations-schema.test.ts` (67 lines) and `generations-isolation.test.ts`
(60 lines) **already exist and pass** — structural proof that `generations` has
exactly the 5 allowed columns (asserts set equality, not just presence, so a
future `source_text` column addition would fail this test) and that source text
never appears in the row; isolation proof (SELECT scoped per-user, cross-user
INSERT rejected with `42501`). These predate any application code — they test
the schema/RLS directly. **S-01 does not need to re-prove schema/isolation**;
it needs to prove its own service/route logic on top of an already-verified
foundation.

**E2E** (`e2e/`): `helpers/island.ts:36-38` — `waitForIslandsHydrated(page)`
polls `astro-island[ssr]` count to 0 via `page.waitForFunction`, required before
any `fill()`/`click()` on a React-island form (hydration race, ~330-687ms
measured). All locators `getByRole` per repo convention. Test data uses
timestamp+random suffixes; cleanup in `test.afterEach` via a real authenticated
client.

## Code References

- `supabase/migrations/20260609211146_reshape_schema_to_prd_model.sql:10-33` — `generations` table + RLS
- `supabase/migrations/20260604000000_create_cards.sql:10-31` — `cards` RLS (unchanged by reshape)
- `supabase/migrations/20260611183943_add_cards_indexes.sql` — cards indexes
- `src/types.ts:1-25` — `Card`, `Generation`, `CreateCardDto`
- `src/pages/api/cards.ts:1-69` — POST route convention (422 validation, per-request client)
- `src/pages/api/cards/[id].ts:1-155` — `openGate()`, `json()` helper, RLS-reliant scoping
- `src/lib/api-error.ts` — `logServerError()` correlation-ref pattern
- `astro.config.mjs:23-28` — `env.schema` secrets declaration
- `src/lib/supabase.ts` — `astro:env/server` import + null-guard pattern
- `src/lib/services/review-schedule.ts` — pure service convention (no I/O, injected `now`)
- `src/components/cards/CreateCardForm.tsx:11-19,45-49` — error-shape disambiguation, fetch pattern
- `src/components/library/LibraryView.tsx:64-113,185-245` — edit-in-place, inline confirm (not `window.confirm`)
- `test/hermetic/cards-error-redaction.test.ts:31-43`, `test/hermetic/card-mutation.test.ts:43-57` — Supabase module-boundary mocking
- `test/hermetic/review-schedule.test.ts` — pure-function test template
- `test/integration/generations-schema.test.ts` — existing schema proof (5 allowed columns, no source text)
- `test/integration/generations-isolation.test.ts` — existing RLS isolation proof
- `e2e/helpers/island.ts:36-38` — `waitForIslandsHydrated()`
- (reference project) `D:\Users\Acer\Documents\Al\kurs10xdev\10x-cards\src\lib\openrouter.service.ts` — full service to port
- (reference project) `D:\Users\Acer\Documents\Al\kurs10xdev\10x-cards\src\lib\generation.service.ts` — orchestration to port (with fixes)
- (reference project) `D:\Users\Acer\Documents\Al\kurs10xdev\10x-cards\.ai\openrouter-service-implementation-plan.md` — original 10-section plan

## Architecture Insights

- This repo's API routes consistently treat RLS as the authorization mechanism
  and 404-on-zero-rows as the "not yours or doesn't exist" signal, never leaking
  which case it was. A new generation-approval endpoint (writing multiple `cards`
  rows tied to one `generation_id`) should keep that shape: scope by
  `user_id = auth.uid()` implicitly via RLS + explicit `user_id` on insert (the
  `cards.ts` POST pattern), not by trusting a client-supplied `generation_id`
  without a re-check.
- Error-body shape (`{error: string | ZodFlattenedError}`) is a hard project-wide
  convention on both server and client (the client-side disambiguation in
  `CreateCardForm`/`LibraryView` exists specifically because violating this once
  already crashed an island). Any new endpoint must return exactly this shape.
- The project has exactly one pure-service precedent (`review-schedule.ts`) and
  the reference project's `generation.service.ts` is NOT pure (does I/O, DB
  writes, hashing) — S-01 should split: a pure "parse/validate LLM response into
  card candidates" function (testable like `review-schedule.ts`) separate from
  an impure "call OpenRouter, hash text, persist generation+cards" orchestrator
  (tested via the Supabase/fetch module-mock convention, like `cards.ts`'s route
  tests).
- No rate limiting exists anywhere in the reference project or this repo. If
  FR-027 or another FR implies a per-user generation rate limit, that's new
  design, not something to port.

## Historical Context (from prior changes)

- `context/archive/2026-06-09-db-schema-mvp/reviews/impl-review.md` §F5/F2 — the
  incident behind `CreateCardForm`'s error-shape disambiguation comment; same
  class of bug (rendering a non-string error object as a React child) is worth
  guarding against in any new form built for the review step.
- `context/changes/testing-data-isolation/` (archived under a different name per
  memory — the m3l2 rollout) is presumably the origin of
  `generations-schema.test.ts`/`generations-isolation.test.ts`, written ahead of
  any application code as structural/RLS proofs. Confirms this repo's established
  pattern of testing schema and RLS independently of the features that will use them.

## Related Research

- None prior for this change-id — this is the first research pass for S-01.

## Open Questions

1. **Exact card count enforcement**: reference project generates 3–10 cards
   model-driven; S-01's outcome says "generate 5 cards". Decide in the plan
   whether to enforce via `response_format` JSON schema (`minItems/maxItems: 5`)
   alone, or also validate/reject in the parsing service if the model returns a
   different count.
2. **Retry-storm handling** (roadmap unknown, owner: Marcin, non-blocking): if
   the LLM fails to return exactly 5 valid cards 3x in a row for the same input,
   infinite retry vs. a "try a different excerpt" user-facing message — needs a
   decision before/during planning.
3. **OpenRouter prompt-logging privacy setting** (PRD Guardrail 2, roadmap.md:99,
   owner: Marcin): confirm the OpenRouter account's data-retention/logging
   setting before the first real API call — not assumed safe by default.
4. **Generation metadata beyond hash+length**: does S-01 need to persist
   `generated_count`/`model`/duration on the `generations` row (as the reference
   project does), or is the current 5-column schema sufficient? If new columns
   are needed, that's a new migration, and `generations-schema.test.ts`'s
   set-equality assertion will need a deliberate, reviewed update (it's designed
   to fail loudly on unplanned additions — that's a feature, not friction).
5. **`generation_error_logs` table**: reference project logs generation failures
   to a dedicated table (auth users only). Decide whether S-01 needs equivalent
   observability or whether `logServerError`'s existing correlation-ref pattern
   (console-only, no DB table) is sufficient for MVP.
   </content>
