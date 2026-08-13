# S-01 first-gated-generation — Plan Brief

> Full plan: `context/changes/first-gated-generation/plan.md`
> Research: `context/changes/first-gated-generation/research.md`

## What & Why

Roadmap slice S-01: let a signed-in user paste source text, generate exactly 5
AI flashcards via OpenRouter, review/edit/reject them, and save the ones they
keep. It's the biggest remaining gap between the certified MVP (5/5 on
`mvp-check.md`) and the actual PRD — 0 of 9 Generation FRs are implemented today,
and S-01 is the prerequisite for the north-star slice S-02 (SRS session).

## Starting Point

`generations` table exists (RLS, immutable, hash+length only) but zero
application code touches it. `cards` table already has everything needed
(`source`, `generation_id`, `leitner_box`, `next_review_at`). The dashboard has a
manual card-creation form and nothing else — no paste field, no AI integration.
No code anywhere in this repo makes an outbound HTTP call to an external service.

## Desired End State

Paste 500–5000 characters on the dashboard → click [Generuj fiszki z AI] → see
exactly 5 editable candidate cards → edit/remove as needed → click [Zatwierdź i
przejdź do nauki] → land on `/library` with the new AI-tagged cards and a
success banner. Failures (timeout, malformed AI response) show a friendly error
with a working [Spróbuj ponownie].

## Key Decisions Made

| Decision                      | Choice                                                                                             | Why                                                                                                                                                    | Source |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Redirect target after approve | `/library`, not an SRS session                                                                     | S-02 (session screen) doesn't exist yet — FR-014's "immediately starts a session" can't be literally satisfied until S-02 ships                        | Plan   |
| `generations` schema          | No new columns                                                                                     | PRD only requires hash+length; `generations-schema.test.ts` asserts the exact column set on purpose                                                    | Plan   |
| Approve persistence           | One `POST /api/generations/:id/approve` with the full edited card array                            | Atomic from the user's perspective; matches existing per-request-client convention                                                                     | Plan   |
| OpenRouter retry budget       | 2 attempts, 12s each, 3s fixed delay between                                                       | Fits inside the 30s hard cutoff (FR-027) with margin; reference project's 3-attempt/8s-backoff budget was too close to the limit                       | Plan   |
| Approve request validation    | Ownership check + ≤5 cards + same 500-char field limit as manual cards                             | Prevents impersonating another user's generation or bulk-inserting arbitrary cards through the endpoint                                                | Plan   |
| Module boundaries             | `src/lib/openrouter.ts` (client) + `src/lib/services/generation.ts` (pure parsing + orchestration) | Matches two existing testing conventions already in the repo (module-mock for I/O, no-mock pure-function tests for logic) instead of inventing a third | Plan   |
| Paste-field validation        | Client-side counter + disabled button, server re-validates                                         | FR-007 says the action should be _unavailable_ out of range, not just rejected after the fact                                                          | Plan   |
| Generation-form blocking      | Only the form is disabled during generation, not the whole page                                    | Matches FR-009's literal scope ("interaction with the generation form")                                                                                | Plan   |
| E2E coverage of the AI call   | None — hermetic tests + one manual real-API pass                                                   | Avoids cost/non-determinism in CI; `page.route()` interception covers the client-side flow without new stub-server infrastructure                      | Plan   |
| Exact card count              | Hard-enforced (throw on ≠5), not best-effort like the reference project                            | FR-027/US-09 define "not exactly 5 well-formed pairs" as the terminal failure condition                                                                | Plan   |

## Scope

**In scope:** paste field + counter, generate endpoint, review UI (edit/remove),
approve endpoint, `/library` success banner, OpenRouter client with typed errors
and bounded retry, hermetic tests for all new logic, one e2e spec, one manual
real-API verification pass.

**Out of scope:** SRS session screen (S-02), new `generations` columns,
rate limiting, `generation_error_logs` table, e2e against real OpenRouter,
double-approve prevention.

## Architecture / Approach

`src/lib/openrouter.ts` (thin HTTP client, typed errors, bounded retry) →
`src/lib/services/generation.ts` (hash + prompt + pure response-parsing +
orchestration, writes `generations` only on success) → two API routes
(`/api/generations` generate-only, `/api/generations/:id/approve` persist-only)
→ `GenerationSection.tsx` React island driving a 4-state client machine
(idle/generating/review/approving) → redirect to `/library?generated=N`.

## Phases at a Glance

| Phase                          | What it delivers                                                         | Key risk                                                                           |
| ------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1. Secrets + OpenRouter client | Mockable HTTP client with typed errors, retry, timeout                   | Retry/timeout budget must genuinely fit the 30s hard cutoff                        |
| 2. Generation service          | Hash, prompt, exact-5 parsing, orchestration                             | Parsing must reject non-5 hard, not best-effort like the reference project         |
| 3. API routes                  | Generate + approve endpoints                                             | Approve endpoint's ownership/limit checks are the main injection surface           |
| 4. Frontend                    | Paste→generate→review→approve UI, library banner                         | State machine complexity (4 states) inside one component                           |
| 5. E2E + manual pass           | Client-flow e2e via route interception, documented manual real-API check | Interception proves the UI, not the real integration — manual pass is load-bearing |

**Prerequisites:** `OPENROUTER_API_KEY` in `.dev.vars` (done); F-01/F-02 (done).
**Estimated effort:** ~5 implementation sessions, one per phase.

## Open Risks & Assumptions

- OpenRouter account prompt-logging/privacy setting (PRD Guardrail 2) — still
  unverified by Marcin as of plan time; doesn't block writing code, but should be
  confirmed before the Phase 1/5 manual verification steps send real user-like
  text.
- `/library` redirect (vs. a real SRS session) is an explicit, documented
  deviation from FR-014's literal wording until S-02 ships — worth flagging in
  any future FR-014 compliance check.

## Success Criteria (Summary)

- A user can go from pasted text to persisted, AI-tagged cards in `/library`
  without touching the database directly.
- A failed/timed-out/malformed generation shows a friendly error and a working
  retry, and leaves no partial data behind.
- All new logic (parsing, service, both routes) has hermetic test coverage; the
  full client flow has one e2e spec; the real OpenRouter round-trip is verified
  manually once per phase that touches it.
  </content>
