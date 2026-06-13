# Google OAuth Switch (F-02) — Plan Brief

> Full plan: `context/changes/google-oauth-switch/plan.md`
> Research: `context/changes/google-oauth-switch/research.md`
> External API digest: `context/changes/google-oauth-switch/supabase-oauth.md`

## What & Why

Replace email+password auth with Google OAuth (server-side PKCE via Supabase). PRD mandates a single external OAuth provider with zero-friction onboarding (FR-001..003): no signup form, no email confirmation, no passwords. F-02 unlocks S-01 (gated generation) and S-04 (account lifecycle).

## Starting Point

Auth works today but with the wrong provider: React forms POST to `/api/auth/{signin,signup}` calling Supabase password methods. The session plumbing — `@supabase/ssr` cookie adapter, middleware `getUser()`, RLS on `auth.uid()` — is provider-agnostic and already PKCE-ready. There is zero OAuth code in the repo and no Google provider configured anywhere.

## Desired End State

Visitor clicks "Zaloguj przez Google" on the landing page, passes Google consent, lands on `/dashboard` with a persistent session. No password surface remains; signed-in users are bounced off `/auth/*`. Verified locally and on deployed Cloudflare Workers (workerd cookie behavior is the known risk).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Library/flow | Supabase `signInWithOAuth` + `exchangeCodeForSession`, server-side PKCE | Grounded in live docs; matches the repo's all-server-side auth pattern | Research |
| Callback route | `/api/auth/callback.ts` | Consistent with repo API layout — all auth endpoints in one folder | Plan |
| Initiation | POST form → redirect to `data.url` | Mirrors existing signout form; POST is prefetch-safe | Plan |
| Canonical origin | `context.url.origin` | Zero config across localhost/workers.dev; safe on Workers | Plan |
| Form components | Delete ALL of `src/components/auth/*` | No consumers left; git history preserves; S-03 will use shadcn forms | Plan |
| Signed-in on `/auth/*` | Middleware bounce → `/dashboard` (page routes only, not `/api/auth/*`) | Few lines, closes the post-OAuth UX hole | Plan |
| `/auth/signin` page | Stays, minimal (Google button + inline `?error=`) | Middleware needs a redirect target; errors need a landing spot | Plan |
| DB/schema | No changes | RLS keys on `auth.uid()` — provider-agnostic (confirmed in F-01 archive) | Research |
| `skip_nonce_check` | Start `false`, flip only on local nonce error | Docs say false; our config.toml template comment says true — resolve empirically | Research |

## Scope

**In scope:** OAuth initiation + callback endpoints; Google provider config (config.toml, Google Console, Supabase dashboard); landing + signin UI; middleware bounce; deletion of signup/confirm-email/password forms; README provider docs; prod verification.

**Out of scope:** second provider, password fallback, `?next=` return-to, DB changes, sign-out/deletion changes (S-04), automated tests (Module 3).

## Architecture / Approach

Both OAuth legs run server-side through the existing per-request SSR client, so all cookie writes (including PKCE `code_verifier`) stay in the one adapter in `src/lib/supabase.ts`. Browser → `POST /api/auth/signin` → redirect to Google → Google → Supabase (`/auth/v1/callback`) → `GET /api/auth/callback?code=` → `exchangeCodeForSession` → `/dashboard`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. OAuth flow backend + provider config | Working local Google sign-in (2 endpoints + 3-place provider config) | Out-of-repo config drift (Console/dashboard/config.toml mismatch) |
| 2. UI switch + removal | Google button everywhere, password surface deleted, signed-in bounce | Dangling imports / missed references (build catches) |
| 3. Deploy verification + docs | Flow proven on workerd, prod URLs allow-listed, README updated | workerd cookie serialization differs from Node (infrastructure.md:60) |

**Prerequisites:** Google Cloud Console access (OAuth client creation), Supabase dashboard access to the linked hosted project.
**Estimated effort:** ~2-3 sessions across 3 phases.

## Open Risks & Assumptions

- `skip_nonce_check` discrepancy (docs vs config.toml template comment) — resolved empirically in Phase 1.
- workerd cookie friction is assumed handled by the existing adapter; Phase 3 exists to prove it.
- Existing email+password test accounts become unreachable — accepted (no production users).

## Success Criteria (Summary)

- Landing-page Google sign-in completes to `/dashboard` with persistent session, locally and on prod (FR-001..003).
- Zero email+password code or pages remain; `/auth/signup` 404s.
- Error paths (consent denial, bare callback) land on `/auth/signin?error=` with a visible message.
