# S-01 first-gated-generation Implementation Plan

## Overview

Implement the roadmap slice S-01: a signed-in user pastes 500–5000 characters of
source text on the dashboard, triggers AI generation, and receives exactly 5
editable flashcard candidates in a review view. They can edit any question/answer
or remove candidates, then approve the batch — remaining cards are persisted as
`source:'ai'`, linked to the generation event, and the user lands on `/library`
with a success banner (S-02's SRS session screen doesn't exist yet, so the redirect
target is `/library`, not a session — see Decision below).

## Current State Analysis

- `generations` table exists (RLS, INSERT+SELECT only) but zero application code
  touches it — confirmed by grep across `src/`.
- `cards` table already supports this: `source enum('ai','manual')`,
  `generation_id uuid references generations(id) on delete set null`,
  `leitner_box`/`next_review_at` default to `1`/`now()` — no schema changes needed.
- `dashboard.astro` renders `CardsSection` (manual `CreateCardForm` + card list)
  and nothing else — no paste field, no generation trigger exists today.
- No code in this repo makes an outbound `fetch()` to an external host — this is
  the first external HTTP integration on the Cloudflare Workers/workerd runtime.
- A working reference implementation exists in the prior course project
  `10x-cards` (`D:\Users\Acer\Documents\Al\kurs10xdev\10x-cards`), but it uses
  Node's `node:crypto` MD5, `import.meta.env`, a module-level Supabase singleton,
  and a "3–10 cards, model-driven" prompt — none of which port as-is (see
  `context/changes/first-gated-generation/research.md`).
- `test/integration/generations-schema.test.ts` and `generations-isolation.test.ts`
  already structurally prove the `generations` table (exact 5-column set, no
  source text, per-user isolation) — this plan does not need to re-prove that.

## Desired End State

A signed-in user can paste text on the dashboard, generate exactly 5 AI flashcard
candidates via OpenRouter (`openai/gpt-4o-mini`), edit/remove candidates in a
review step, and approve to persist them as `cards` rows tied to a `generations`
row — landing on `/library` with a banner showing how many new cards were added.
Failed/timed-out/malformed generations show a friendly error with a
[Spróbuj ponownie] action that re-issues the same request with the same text, and
persist nothing. Verify via: `npm run test:hermetic` (new suites green), manual
walkthrough with a real `OPENROUTER_API_KEY` (paste → generate → edit → remove →
approve → land on `/library` with real persisted cards), and the new e2e spec.

### Key Discoveries

- `src/lib/supabase.ts` and `astro.config.mjs:23-28` establish the
  `astro:env/server` secrets pattern (`envField.string({context:"server",
access:"secret", optional:true})`) — `OPENROUTER_API_KEY` follows the same shape.
- `src/pages/api/cards.ts` and `src/pages/api/cards/[id].ts` establish: `422` for
  Zod validation failures (not `400`), `{error: string | ZodFlattenedError}` as the
  universal error body, `logServerError()` for correlation-ref'd `500`s, and
  RLS-reliant scoping with an explicit `user_id` set on insert.
- `src/components/cards/CreateCardForm.tsx:11-19` — the error-shape
  disambiguation (`typeof data.error === "string" ? data.error : fallback`) exists
  because rendering a raw error object once crashed a React island
  (`context/archive/2026-06-09-db-schema-mvp/reviews/impl-review.md` §F5/F2). Any
  new form must replicate it.
- `test/hermetic/card-mutation.test.ts` / `cards-error-redaction.test.ts` — the
  `vi.mock("@/lib/...")` module-boundary convention this plan's new hermetic
  tests will follow for both Supabase and the new OpenRouter client.
- PRD text (read in full for this plan): FR-008/US-04 require **exactly 5** cards
  — the reference project's "3 to 10, model-driven" prompt must not be ported;
  FR-027/US-09 define failure as "exceeds 30s OR does not contain exactly five
  well-formed pairs," with a single **manual** [Spróbuj ponownie] action, distinct
  from any _internal_ automatic retry the OpenRouter client performs on transient
  errors.

## What We're NOT Doing

- Not building S-02 (SRS session screen) — approval redirects to `/library`
  instead of starting a session (see Decision below).
- Not adding columns to `generations` (`model`, `generated_count`, duration) —
  the 5-column schema already satisfies PRD Guardrail 2, and
  `generations-schema.test.ts` asserts the exact column set on purpose.
- Not adding a "generation already approved" flag/column to prevent double-approve
  — a user re-approving their own generation is low-stakes (own data only) and out
  of scope for MVP.
- Not adding rate limiting on generation requests.
- Not running any e2e test against the real OpenRouter API (cost + non-determinism)
  — covered by hermetic tests + one documented manual verification pass.
- Not porting the reference project's `generation_error_logs` table — this repo's
  existing `logServerError()` correlation-ref pattern is the observability layer.
- Not touching `middleware.ts` / `PROTECTED_ROUTES` — the new API routes follow
  `cards.ts`'s convention of checking `context.locals.user` directly, same as
  every existing API route.

## Implementation Approach

Five phases, each independently testable, in dependency order: (1) the OpenRouter
HTTP client in isolation, (2) the generation service built on top of it (pure
parsing separated from impure orchestration, mirroring `review-schedule.ts` vs.
`api/cards.ts`), (3) the two API routes, (4) the frontend review flow, (5) an e2e
spec using `page.route()` interception (no real network calls, no stub server
infra) plus a manual verification checklist for the one thing that can't be
cheaply automated: a real round-trip through OpenRouter.

## Critical Implementation Details

**Two independent retry layers, don't conflate them.** FR-027/US-09's
[Spróbuj ponownie] is a **manual, user-initiated** re-issue of the _same_ request
after a terminal failure is shown. Separately, `src/lib/openrouter.ts` performs
its own **automatic** retry (max 2 attempts) on transient errors (timeout/429/5xx)
before that terminal failure is ever surfaced. Budget: each attempt has a 12s
`AbortController` timeout, with a fixed 3s delay before the second attempt —
worst case ≈27s, safely inside the 30s hard cutoff (FR-027) with margin for
routing/serialization. No jitter/backoff curve is needed for a 2-attempt budget
triggered by a single user action (not a request storm).

**Generation record is written only on success.** `generateFlashcards()` inserts
the `generations` row (hash + length) _after_ the LLM call succeeds and parses
into exactly 5 valid candidates — not before, not on failure. A failed attempt
leaves no trace beyond the client-side error the user sees, consistent with
"the system does not persist any cards from a failed or invalid generation"
(US-09 acceptance criteria) extended to the generation record itself, since a
generation row with no approvable candidates has no purpose.

**Exact-5 enforcement, not best-effort.** Unlike the reference project (accepts
3–10 cards, defensively reshapes almost anything into a card list), this
project's parser must treat "not exactly 5 valid, well-formed pairs" as a hard
failure (throws), because FR-027/US-09 define that as the terminal-error
condition the client shows [Spróbuj ponownie] for. No padding, no truncating the
list to 5, no accepting 4 or 6.

## Phase 1: Secrets + OpenRouter client

### Overview

Add the `OPENROUTER_API_KEY` secret and build a standalone, mockable HTTP client
for OpenRouter's chat completions endpoint, with the retry/timeout budget from
"Critical Implementation Details" above.

### Changes Required:

#### 1. Secrets schema

**File**: `astro.config.mjs`

**Intent**: Declare `OPENROUTER_API_KEY` as a server-only secret, following the
exact pattern already used for `SUPABASE_URL`/`SUPABASE_KEY`.

**Contract**: Add `OPENROUTER_API_KEY: envField.string({ context: "server",
access: "secret", optional: true })` to the `env.schema` block
(`astro.config.mjs:23-28`).

#### 2. OpenRouter client

**File**: `src/lib/openrouter.ts` (new)

**Intent**: A single exported async function that sends one chat-completion
request to OpenRouter with structured-JSON output, retries once on transient
failure, and throws typed errors the caller (and its tests) can branch on. This
is the module hermetic tests will `vi.mock()` wholesale, same as `@/lib/supabase`
is mocked today.

**Contract**:

- Exports an error hierarchy: `OpenRouterAuthError` (401 — not retried),
  `OpenRouterRateLimitError` (429 — retried), `OpenRouterNetworkError`
  (timeout/5xx/fetch failure — retried), `OpenRouterProtocolError` (any other
  non-2xx, or a 2xx body that isn't valid JSON at the HTTP layer — not retried).
  All extend a common `OpenRouterError` with `message`/`code`.
- Exports `requestChatCompletion(params: { apiKey: string; systemPrompt: string;
userMessage: string; jsonSchema: Record<string, unknown> }): Promise<string>`
  — returns the raw `choices[0].message.content` string (parsing/validating that
  string into flashcards is Phase 2's job, not this module's).
- POSTs to `https://openrouter.ai/api/v1/chat/completions` with
  `Authorization: Bearer <apiKey>`, `model: "openai/gpt-4o-mini"`,
  `messages: [{role:"system",...},{role:"user",...}]`,
  `response_format: {type:"json_schema", json_schema:{name:"flashcards_response",
strict:true, schema: jsonSchema}}`, `temperature: 0.7`, `max_tokens: 2000`.
  Drop the reference project's `HTTP-Referer`/`X-Title` headers (attribution
  only, not load-bearing) rather than porting stale values.
- Retry loop: attempt 1 → on `OpenRouterRateLimitError`/`OpenRouterNetworkError`,
  wait 3000ms → attempt 2 → on failure, throw the last error. `AbortController`
  per attempt at 12000ms; an abort maps to `OpenRouterNetworkError`.
  `OpenRouterAuthError`/`OpenRouterProtocolError` throw immediately, no retry.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx astro check` passes
- New hermetic test file `test/hermetic/openrouter-client.test.ts` covers: success
  response → returns content string; 401 → `OpenRouterAuthError`, single fetch
  call (no retry); 429 then success on 2nd attempt → succeeds, two fetch calls;
  429 twice → throws `OpenRouterRateLimitError` after two attempts; abort/timeout
  → `OpenRouterNetworkError`; non-2xx non-mapped status → `OpenRouterProtocolError`,
  no retry. Use `vi.stubGlobal("fetch", ...)` in this file only (it's the module
  being tested, not a boundary being mocked) and fake timers for the 3000ms delay.
- `npm run test:hermetic` passes

#### Manual Verification:

- With a real `OPENROUTER_API_KEY` in `.dev.vars`, a throwaway script or REPL call
  to `requestChatCompletion` returns real model output (sanity check before
  building on top of it).

---

## Phase 2: Generation service

### Overview

Build the business logic on top of the Phase 1 client: hash the source text,
construct the exact-5 prompt, parse/validate the model's response into
candidates, and orchestrate the full generate-and-record flow. Split pure
(parsing) from impure (I/O), mirroring `review-schedule.ts` vs. `api/cards.ts`.

### Changes Required:

#### 1. Generation service

**File**: `src/lib/services/generation.ts` (new)

**Intent**: Owns the flashcard-generation domain logic: hashing, prompting,
parsing the LLM's response into exactly 5 validated candidates, and orchestrating
the OpenRouter call + `generations` insert. Nothing here talks to `cards` — that's
the approve endpoint's job (Phase 3), keeping "generate" and "persist" as
separate, independently-testable concerns matching FR-010 (review view) vs.
FR-014 (approve/persist) being distinct steps in the PRD.

**Contract**:

- `export const EXPECTED_CARD_COUNT = 5`, `export const SOURCE_TEXT_MIN_LENGTH =
500`, `export const SOURCE_TEXT_MAX_LENGTH = 5000`, `export const
CARD_FIELD_MAX_LENGTH = 500` (matches `CreateCardForm`'s existing per-field
  limit — re-exported here so the API route and any future caller share one
  source of truth instead of duplicating the number).
- `export async function hashSourceText(text: string): Promise<string>` — SHA-256
  over the UTF-8 bytes via Web Crypto (`crypto.subtle.digest`, Workers-native,
  unlike the reference project's Node-only `createHash('md5')`), returned as a
  lowercase hex string.
- `export type FlashcardCandidate = { question: string; answer: string }`.
- `export function parseFlashcardCandidates(rawContent: string):
FlashcardCandidate[]` — pure, throws `GenerationValidationError` (new class,
  same file) if it can't produce exactly `EXPECTED_CARD_COUNT` valid
  (non-empty-after-trim, string) pairs. Parsing order: direct `JSON.parse` first;
  on failure, the reference project's regex fallback for a `{...}` block
  containing `"flashcards"`, then for a bare `[...]` array — both scoped down
  from `/[\s\S]*/` to non-greedy where possible to avoid pathological backtracking
  on long inputs. Each candidate's `question`/`answer` is trimmed and hard-clamped
  to `CARD_FIELD_MAX_LENGTH`. **Exactly 5 or throw — no padding, no truncating the
  list, no accepting 4 or 6** (see Critical Implementation Details).
- `export async function generateFlashcards(supabase: SupabaseClient, userId:
string, sourceText: string): Promise<{ generationId: string; candidates:
FlashcardCandidate[] }>` — orchestrates: `hashSourceText` → build the system/user
  prompt (see below) → `requestChatCompletion` from `@/lib/openrouter` → `throw`s
  through any `OpenRouterError`/`GenerationValidationError` unchanged (caller maps
  status codes) → on success, insert `{user_id: userId, source_text_hash,
source_text_length: sourceText.length}` into `generations`, `.select().single()`
  → return `{generationId: data.id, candidates}`.
- System prompt: adapted from the reference project's Polish prompt, changed from
  "Wygeneruj od 3 do 10 fiszek w zależności od ilości materiału" to an explicit
  "Wygeneruj dokładnie 5 fiszek." User message: `` `Przeanalizuj poniższy tekst i
wygeneruj fiszki edukacyjne w tym samym języku:\n\n${sourceText}` `` (language
  instruction folded in per FR-008). JSON schema passed to
  `requestChatCompletion`: `{type:"object", properties:{flashcards:{type:"array",
minItems:5, maxItems:5, items:{type:"object",
properties:{question:{type:"string"},answer:{type:"string"}},
required:["question","answer"], additionalProperties:false}}},
required:["flashcards"], additionalProperties:false}` — the `minItems`/`maxItems`
  constraint is new versus the reference project (which had none), enforcing
  exactly 5 at the schema level as a first line of defense before
  `parseFlashcardCandidates`'s own count check.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx astro check` passes
- New hermetic test file `test/hermetic/generation-parsing.test.ts` — pure,
  no mocks, mirrors `review-schedule.test.ts`'s style (`it.each` table, oracles
  transcribed from the FR text). Cases: valid direct JSON with exactly 5 → passes
  through; valid JSON wrapped in prose (regex-fallback path) → recovers 5;
  exactly 4 valid pairs → throws; 6 pairs → throws; a pair with an empty
  `answer` → excluded, drops count below 5 → throws; a field exceeding
  `CARD_FIELD_MAX_LENGTH` → clamped, not rejected; totally unparseable garbage →
  throws.
- New hermetic test file `test/hermetic/generation-service.test.ts` —
  `vi.mock("@/lib/openrouter")` and `vi.mock("@/lib/supabase")` (or an injected
  Supabase-like stub matching the `card-mutation.test.ts` shape) covering:
  success → `generations` row inserted with correct hash/length, returns
  candidates; `OpenRouterError` thrown by the client → propagates, **no**
  `generations` insert attempted (assert the mock insert function was never
  called); `GenerationValidationError` from parsing → propagates, no insert.
- `npm run test:hermetic` passes

#### Manual Verification:

- N/A for this phase alone — covered by Phase 3's manual verification once wired
  to a real route.

---

## Phase 3: API routes

### Overview

Expose the generation service over HTTP: `POST /api/generations` to generate and
`POST /api/generations/:id/approve` to persist the (possibly edited/reduced)
batch as `cards`.

### Changes Required:

#### 1. Generate endpoint

**File**: `src/pages/api/generations.ts` (new)

**Intent**: Accepts pasted source text, runs the generation service, returns the
5 candidates for client-side review — nothing is written to `cards` here.

**Contract**: `export const prerender = false`. `export const POST: APIRoute`
following `cards.ts`'s shape: `401` if no `context.locals.user`; `400` on JSON
parse failure; Zod `{source_text: z.string().trim().min(SOURCE_TEXT_MIN_LENGTH,
"...").max(SOURCE_TEXT_MAX_LENGTH, "...")}` → `422` with `z.flattenError(...)` on
failure; read `OPENROUTER_API_KEY` from `astro:env/server`, `503` if missing (same
null-guard style as `src/lib/supabase.ts`); per-request `createClient(...)`, `503`
if null; call `generateFlashcards`; on success `201` with `{generation_id,
cards: candidates}`. Error mapping: `OpenRouterAuthError` or a missing key →
`503` + `logServerError` (server misconfiguration, not the user's fault);
`OpenRouterRateLimitError`/`OpenRouterNetworkError` (retries exhausted) → `504`
with a friendly message; `GenerationValidationError`/`OpenRouterProtocolError` →
`502` with a friendly message; anything else → `500` + `logServerError` with a
support-reference message, matching `cards.ts`'s existing pattern.

#### 2. Approve endpoint

**File**: `src/pages/api/generations/[id]/approve.ts` (new)

**Intent**: Persists the user's final (edited/reduced) candidate list as `cards`
rows tied to the given generation, after confirming the generation belongs to the
caller.

**Contract**: `export const prerender = false`. `export const POST: APIRoute`.
`401` if no user. `z.uuid()` on the `id` param → `400` on failure (matches
`[id].ts`'s existing param-validation shape for `cards/[id].ts`). Body Zod:
`{cards: z.array(z.object({question: z.string().trim().min(1).max(CARD_FIELD_MAX_LENGTH),
answer: z.string().trim().min(1).max(CARD_FIELD_MAX_LENGTH)})).min(1).max(EXPECTED_CARD_COUNT)}`
→ `422` on failure. Ownership check: `SELECT id FROM generations WHERE id = :id`
via the per-request Supabase client (RLS scopes this to the caller's own rows
already) `.maybeSingle()`; `null` → `404` (same "RLS-denied reads as 404" pattern
as `cards/[id].ts`, documented there). Insert:
`.from("cards").insert(cards.map(c => ({question: c.question, answer: c.answer,
user_id: user.id, source: "ai", generation_id: id}))).select()`; DB error → `500`

- `logServerError`; success → `201` with `{cards: insertedRows}`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx astro check` passes
- New hermetic test file `test/hermetic/generations-route.test.ts` (mirrors
  `cards-error-redaction.test.ts`'s dynamic-import-after-mock pattern), mocking
  `@/lib/services/generation` as a whole module: unauthenticated → `401`;
  malformed JSON → `400`; text length 499/5001 → `422`; missing
  `OPENROUTER_API_KEY` → `503`; `generateFlashcards` throwing each error type →
  correct status per the mapping table above; success → `201` with the expected
  body shape.
- New hermetic test file `test/hermetic/generations-approve-route.test.ts`,
  mocking `@/lib/supabase`: unauthenticated → `401`; invalid UUID param → `400`;
  0 cards / 6 cards in body → `422`; a card with 501-char question → `422`;
  generation not found (mocked `maybeSingle` → `null`) → `404`; DB insert error →
  `500`; success → `201` with inserted rows including `source:"ai"` and the
  correct `generation_id`.
- `npm run test:hermetic` passes

#### Manual Verification:

- With a real `OPENROUTER_API_KEY` and local Supabase running: `curl` or REST
  client round-trip — `POST /api/generations` with valid session cookie and
  500–5000 chars of real text returns 5 real candidates; `POST
/api/generations/<id>/approve` with an edited/reduced subset returns the
  persisted rows with `source:"ai"` and the right `generation_id`; a request with
  someone else's `generation_id` returns `404`.

---

## Phase 4: Frontend

### Overview

Add the paste-generate-review-approve flow to the dashboard, and a post-approve
success banner on `/library`.

### Changes Required:

#### 1. Generation section component

**File**: `src/components/cards/GenerationSection.tsx` (new)

**Intent**: Owns the full client-side flow — idle (paste + counter) →
generating (blocked form + spinner) → review (editable candidates, per-card
remove) → approving → navigate to `/library`. Sits alongside (not replacing)
`CreateCardForm` in `CardsSection`, since FR-006's "single field on the main
screen" is about the generation trigger, not a removal of manual card creation.

**Contract**:

- State machine: `idle | generating | review | approving`, plus `sourceText`,
  `candidates: FlashcardCandidate[]`, `generationId`, `error`.
- Idle: `<textarea>` bound to `sourceText`; live counter `"{n} / 5000 znaków
(min. 500)"`; [Generuj fiszki z AI] `disabled` unless `500 <= sourceText.length
<= 5000`, and disabled during `generating` (FR-009: block the generation form,
  not the whole page — `Sign out` etc. stay interactive).
- On submit: `POST /api/generations`; success → populate `candidates`/
  `generationId`, state → `review`; failure → same error-shape disambiguation as
  `CreateCardForm.tsx:11-19` (`typeof data.error === "string" ? data.error :
fallback`), state stays `idle`-adjacent with an error banner and a [Spróbuj
  ponownie] button that resubmits the **same** `sourceText` (US-09) without
  requiring the user to re-paste.
- Review: one block per candidate with editable `question`/`answer` inputs and a
  remove (✕) button — no confirmation dialog (unlike `LibraryView`'s delete,
  these are pre-persistence and reversible by regenerating; FR-012 doesn't ask
  for one). [Zatwierdź i przejdź do nauki] disabled if zero candidates remain or
  any remaining candidate has an empty `question`/`answer` after edits. FR-013:
  no "add a card" control anywhere in this view.
- On approve: `POST /api/generations/${generationId}/approve` with the current
  edited/filtered `candidates`; success → `window.location.href =
"/library?generated=" + insertedCount`; failure → error banner, stay in
  `review` state (don't discard the user's edits).

#### 2. Wire into dashboard

**File**: `src/components/cards/CardsSection.tsx`

**Intent**: Render the new section above the existing manual-create form.

**Contract**: Add `<GenerationSection />` before the existing `<CreateCardForm
onCardAdded={handleCardAdded} />` block; no changes to `CreateCardForm` itself or
to the manual-card list rendering below it.

#### 3. Library success banner

**Files**: `src/pages/library.astro`, `src/components/library/LibraryView.tsx`

**Intent**: Show a one-time confirmation of how many AI-generated cards just
landed, without a server round-trip.

**Contract**: `library.astro` reads `Astro.url.searchParams.get("generated")`,
parses to a non-negative integer (`0` if absent/invalid), passes as a new
`generatedCount` prop to `LibraryView`. `LibraryView` renders a dismissible
banner (`role="status"`, matching the existing `role="alert"` convention for
errors) when `generatedCount > 0`, e.g. `"{n} nowych fiszek gotowych do nauki"`,
and strips the `generated` query param via `window.history.replaceState` on
mount so a page refresh doesn't re-show it.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx astro check` passes
- `npm run test:hermetic` passes (no regressions in existing suites)

#### Manual Verification:

- Paste <500 chars: button disabled, counter shows the shortfall.
- Paste 500–5000 chars, click generate: form blocks, spinner shows, `Sign out`
  remains clickable.
- Successful generation: exactly 5 editable cards appear; edit one, remove one;
  approve; land on `/library` with a banner reading "4 nowych fiszek..."; refresh
  `/library` — banner is gone.
- Force a server error (e.g. temporarily wrong `OPENROUTER_API_KEY`): friendly
  error + [Spróbuj ponownie] appears; clicking it resubmits without requiring
  re-paste.

---

## Phase 5: E2E + manual integration pass

### Overview

Add one e2e spec covering the full client-side review→approve→redirect flow
without touching the real OpenRouter API or real DB writes for the generation
step, using Playwright's `page.route()` interception — no new stub-server
infrastructure, no CI/env changes. Close the gap that interception can't cover
with a documented manual pass.

### Changes Required:

#### 1. E2E spec

**File**: `e2e/flashcard-generation.spec.ts` (new)

**Intent**: Exercise the real dashboard UI (real hydration, real form, real
review/edit/remove interactions, real navigation) against **intercepted**
responses for both new endpoints — proving the client-side state machine and
`/library` redirect work end-to-end without depending on OpenRouter's
availability, cost, or non-deterministic card counts.

**Contract**: Authenticated via existing `storageState` (per `auth.setup.ts`
convention). `page.goto("/dashboard")` → `waitForIslandsHydrated(page)` (required
before any `fill()`, per the documented island-hydration race in
`e2e/helpers/island.ts`). `page.route("**/api/generations", ...)` fulfills with a
canned `201` body (5 fixed candidates, a well-formed but non-existent
`generation_id`) _before_ filling the textarea and clicking [Generuj fiszki z
AI]. Assert 5 cards render via `getByRole`. Edit one field, remove one card via
its remove button (now 4 remain). `page.route("**/api/generations/*/approve",
...)` fulfills with a canned `201` echoing the 4 cards with fake ids. Click
[Zatwierdź i przejdź do nauki]; assert `page.waitForURL(/\/library/)` and that
the banner text contains "4". No DB writes occur (both calls are intercepted
client-side, never reach the server), so no `test.afterEach` cleanup is needed —
first e2e spec in this repo without one, worth a one-line comment explaining why.

### Success Criteria:

#### Automated Verification:

- `npm run test:e2e` passes locally (`E2E_DEV=1` loop) and the full suite passes
  against the built app (`npm run test:e2e`, default build+preview mode)
- CI `E2E (Playwright)` job stays green

#### Manual Verification:

- **The one round-trip that stays manual, documented here rather than automated**:
  with a real `OPENROUTER_API_KEY`, walk the full flow in a browser against local
  Supabase — paste real text, generate, confirm 5 real model-generated cards,
  approve, confirm the rows exist in `cards` with `source='ai'` and the right
  `generation_id`, confirm `/library` shows them.
- Confirm a real timeout/error path once: temporarily point
  `OPENROUTER_API_KEY` at an invalid value, verify the `503` friendly-error path
  end-to-end in the browser (not just in hermetic tests).

---

## Testing Strategy

### Unit Tests:

- `parseFlashcardCandidates` — pure, table-driven, oracles from FR-008/FR-027
  text (exactly 5, well-formed). See Phase 2.
- `hashSourceText` — deterministic output for the same input, different output
  for different input (no need to test against a fixed SHA-256 vector; behavior,
  not the algorithm, is what this repo owns).

### Integration Tests:

- None new — `generations`/`cards` RLS and schema are already proven by
  `test/integration/generations-*.test.ts` and `cards-isolation.test.ts`. This
  plan's new logic (service orchestration, route validation) is covered by
  hermetic tests with mocked Supabase, consistent with how `cards.ts`/`[id].ts`
  are tested today.

### Manual Testing Steps:

1. See each phase's Manual Verification above — the real-OpenRouter round-trip
   (Phase 5) is the one step with no automated equivalent by design.

## Performance Considerations

Total request budget (client submit → response) is bounded by the 30s hard
cutoff (FR-027): up to 2 OpenRouter attempts × 12s each + one 3s backoff ≈ 27s
worst case, leaving margin for routing/serialization. p95 target of 10s (US-04)
is a property of OpenRouter's typical latency, not something this plan can
enforce in code — no action needed beyond not adding artificial delay.

## Migration Notes

No database migration in this plan — see "What We're NOT Doing."

## References

- Research: `context/changes/first-gated-generation/research.md`
- Reference implementation: `D:\Users\Acer\Documents\Al\kurs10xdev\10x-cards\src\lib\openrouter.service.ts`, `generation.service.ts`
- Card mutation route pattern: `src/pages/api/cards/[id].ts`
- Error redaction pattern: `src/lib/api-error.ts`
- Pure-service test template: `test/hermetic/review-schedule.test.ts`
- Island hydration helper: `e2e/helpers/island.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Secrets + OpenRouter client

#### Automated

- [x] 1.1 `npm run lint` passes — c020582
- [x] 1.2 `npx astro check` passes — c020582
- [x] 1.3 New hermetic test file `test/hermetic/openrouter-client.test.ts` covers success/401/429-retry/429-exhausted/timeout/protocol-error paths — c020582
- [x] 1.4 `npm run test:hermetic` passes — c020582

#### Manual

- [x] 1.5 Real `OPENROUTER_API_KEY` sanity call to `requestChatCompletion` returns real model output — c020582

### Phase 2: Generation service

#### Automated

- [x] 2.1 `npm run lint` passes
- [x] 2.2 `npx astro check` passes
- [x] 2.3 New hermetic test file `test/hermetic/generation-parsing.test.ts` covers valid/regex-fallback/wrong-count/empty-field/oversize/garbage cases
- [x] 2.4 New hermetic test file `test/hermetic/generation-service.test.ts` covers success, OpenRouterError propagation with no insert, GenerationValidationError propagation with no insert
- [x] 2.5 `npm run test:hermetic` passes

### Phase 3: API routes

#### Automated

- [ ] 3.1 `npm run lint` passes
- [ ] 3.2 `npx astro check` passes
- [ ] 3.3 New hermetic test file `test/hermetic/generations-route.test.ts` covers auth/parse/length/missing-key/error-mapping/success
- [ ] 3.4 New hermetic test file `test/hermetic/generations-approve-route.test.ts` covers auth/param/body-limits/not-found/db-error/success
- [ ] 3.5 `npm run test:hermetic` passes

#### Manual

- [ ] 3.6 Real curl/REST round-trip: generate returns 5 real candidates, approve persists edited subset with correct `source`/`generation_id`, foreign `generation_id` returns 404

### Phase 4: Frontend

#### Automated

- [ ] 4.1 `npm run lint` passes
- [ ] 4.2 `npx astro check` passes
- [ ] 4.3 `npm run test:hermetic` passes (no regressions)

#### Manual

- [ ] 4.4 Paste <500 chars: button disabled, counter shows shortfall
- [ ] 4.5 Valid paste + generate: form blocks, spinner shows, Sign out stays clickable
- [ ] 4.6 Successful generation → edit → remove → approve → `/library` banner "4 nowych fiszek..." → refresh clears banner
- [ ] 4.7 Forced server error shows friendly message + working [Spróbuj ponownie]

### Phase 5: E2E + manual integration pass

#### Automated

- [ ] 5.1 `npm run test:e2e` passes locally (E2E_DEV=1)
- [ ] 5.2 `npm run test:e2e` passes against built app
- [ ] 5.3 CI `E2E (Playwright)` job green

#### Manual

- [ ] 5.4 Real OPENROUTER_API_KEY full browser walkthrough persists real cards with correct source/generation_id
- [ ] 5.5 Real error path (invalid key) shows friendly 503 error end-to-end in browser
      </content>
