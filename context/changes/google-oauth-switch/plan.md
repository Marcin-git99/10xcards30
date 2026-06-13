# Google OAuth Switch (F-02) Implementation Plan

## Overview

Replace email+password authentication with Google OAuth (server-side PKCE flow via Supabase). Covers FR-001 (sign-in from landing page), FR-002 (auto-create / reconnect by stable external identifier — handled by Supabase `auth.users.id`), FR-003 (persistent session via existing SSR cookies). Unlocks S-01 and S-04.

## Current State Analysis

Full map in `research.md`. Essentials:

- Auth is 100% server-side: React form islands POST to `/api/auth/{signin,signup,signout}`, which call Supabase password methods through a per-request SSR client (`src/lib/supabase.ts:5-23`).
- Middleware (`src/middleware.ts:4-22`) resolves user via `getUser()` per request, sets `locals.user`, guards `PROTECTED_ROUTES = ["/dashboard"]`. Auth pages do NOT bounce signed-in users.
- **Zero OAuth code exists**: no `signInWithOAuth`, no callback route, no `exchangeCodeForSession` (grep-confirmed).
- Cookie adapter is already PKCE-ready — `createServerClient` defaults to PKCE; `code_verifier` cookie will flow through the existing `getAll`/`setAll`.
- `supabase/config.toml:150-156` has stale values (`site_url` port 3000, https `additional_redirect_urls`) and no `[auth.external.google]` block. CLI is linked to a hosted project — dashboard config needed too.
- RLS keys on `auth.uid()` — provider-agnostic, no DB work.
- Known risk: `@supabase/ssr` cookie serialization differs in workerd vs Node (`context/foundation/infrastructure.md:60`) — prod verification is its own phase.

## Desired End State

A visitor clicks "Zaloguj przez Google" on the landing page (or `/auth/signin`), completes Google consent, lands on `/dashboard` with a persistent session. No email+password surface remains (no signup page, no confirm-email page, no password forms). Signed-in users are bounced off `/auth/*`. Flow verified locally AND on deployed Cloudflare Workers.

### Key Discoveries:

- `signInWithOAuth({ provider, options: { redirectTo } })` returns `data.url` — server must redirect the browser there; the same call writes the `code_verifier` cookie through the SSR client (`supabase-oauth.md`).
- `exchangeCodeForSession(code)` is PKCE-only, returns `{ data: { session, user }, error }`; session cookies written via `setAll`.
- Google Console redirect URI is the **Supabase** callback (`https://<project-ref>.supabase.co/auth/v1/callback`), not the app's. The app callback must be allow-listed in Supabase (`additional_redirect_urls` locally / Auth URL config in dashboard).
- Existing error convention: round-trip via `?error=` query param to the auth page (`src/pages/api/auth/signin.ts:17`) — callback reuses it.
- Existing initiation convention: POST forms (signout form in `Topbar.astro:16-19`) — Google button follows it.

## What We're NOT Doing

- No second OAuth provider, no email+password fallback, no password reset / email verification (PRD Non-Goals, prd.md:241-242).
- No `?next=` return-to param in middleware redirects (post-sign-in always lands on `/dashboard`).
- No DB/schema/RLS changes — F-01 covered them; identity anchor `auth.users.id` works as-is.
- No account deletion / sign-out changes — `signout.ts` already satisfies FR-004; deletion is S-04.
- No new env vars — canonical origin derives from `context.url.origin` (decision: Origin).
- No automated test suite — project has no test runner yet (Module 3 scope); verification is lint + build + manual flows.

## Implementation Approach

Follow the codebase's established server-side pattern: both OAuth legs run through the per-request SSR client so all cookie writes stay in one adapter. Rework `/api/auth/signin` in place (POST → `signInWithOAuth` → redirect to `data.url`), add `/api/auth/callback` (GET → `exchangeCodeForSession` → redirect). Then swap the UI and delete the password surface in one sweep. Verify on deployed workerd last, because cookie behavior there is the known risk.

Decisions locked during planning (see `plan-brief.md` for the table): callback at `/api/auth/callback.ts`; initiation via POST form; origin from `context.url.origin`; delete ALL `src/components/auth/*` components; middleware bounces signed-in users off `/auth/*`; `/auth/signin` stays as a minimal Google-button page.

## Critical Implementation Details

- **`code_verifier` cookie timing**: the cookie is written during the initiation request — the redirect response to `data.url` must carry the `Set-Cookie`. Astro's `context.cookies.set` + `context.redirect` handles this, but do NOT use `Response.redirect()` directly (it bypasses AstroCookies).
- **`skip_nonce_check` discrepancy**: current Google docs example shows `false`; the apple-template comment in our `config.toml:315-316` claims `true` is required for local Google sign-in. Start with `false`; if local sign-in fails with a nonce error, flip to `true` (local only — hosted project is unaffected).
- **`createClient` returns null** when env vars are missing — both new/reworked endpoints must null-check and redirect to `/auth/signin?error=...` like the existing code does.

## Phase 1: OAuth flow backend + provider config

### Overview

Working Google sign-in end-to-end against local Supabase: initiation endpoint, callback endpoint, provider configuration (config.toml + Google Cloud Console + hosted dashboard).

### Changes Required:

#### 1. Rework sign-in endpoint to OAuth initiation

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Replace `signInWithPassword` FormData handling with OAuth initiation. POST (no body needed) → call `signInWithOAuth` → redirect browser to Google.

**Contract**: `POST /api/auth/signin`. Calls `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: \`${new URL(context.request.url).origin}/api/auth/callback\` } })`; on success `return context.redirect(data.url)`; on error or null client redirect to `/auth/signin?error=<message>`. Keep `export const prerender = false` and uppercase `POST` export.

#### 2. New callback endpoint

**File**: `src/pages/api/auth/callback.ts` (new)

**Intent**: Receive the provider redirect, exchange the auth code for a session, land the user on the dashboard.

**Contract**: `GET /api/auth/callback`. Reads `?code=` → `supabase.auth.exchangeCodeForSession(code)` → redirect `/dashboard`. Reads `?error=`/`?error_description=` (provider denial) or exchange failure → redirect `/auth/signin?error=<message>`. Missing both `code` and `error` → redirect `/auth/signin?error=invalid_callback`. Per-request client from `(request.headers, cookies)` like sibling endpoints; null-check client.

#### 3. Local provider config

**File**: `supabase/config.toml`

**Intent**: Enable Google provider locally and fix stale auth URLs so the local CLI stack accepts the app's callback.

**Contract**: `[auth]`: `site_url = "http://127.0.0.1:4321"`, `additional_redirect_urls = ["http://127.0.0.1:4321/api/auth/callback", "http://localhost:4321/api/auth/callback"]`. New `[auth.external.google]`: `enabled = true`, `client_id = "<web-client-id>"`, `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"`, `skip_nonce_check = false` (flip to `true` only if local nonce error — see Critical Implementation Details). Secret env var goes in the shell env / `supabase/.env` the CLI reads — NOT in `.dev.vars` (that's workerd's file).

#### 4. Out-of-repo configuration (manual, user-performed)

**File**: — (Google Cloud Console + Supabase dashboard)

**Intent**: Create the OAuth client and register it with both Supabase environments.

**Contract**: Google Console: OAuth client type "Web application"; Authorized JavaScript origins: `http://localhost:4321` (dev) + prod origin (Phase 3); Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback` AND `http://127.0.0.1:54321/auth/v1/callback` (local CLI). Supabase dashboard: enable Google provider with Client ID + Secret; Auth URL configuration gets the prod app callback in Phase 3.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Local Supabase restarts cleanly with new config: `npx supabase stop && npx supabase start`

#### Manual Verification:

- Full local flow: click-through `POST /api/auth/signin` → Google consent → callback → lands on `/dashboard` with `locals.user` populated (Topbar shows email)
- Session persists across reload (FR-003) and sign-out still works (FR-004)
- Denial path: cancel on Google consent screen → lands on `/auth/signin?error=...` with message visible
- Direct hit on `/api/auth/callback` without params → redirected to `/auth/signin?error=invalid_callback`

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: UI switch + email+password removal

### Overview

Google button on landing + signin page, signed-in bounce in middleware, and deletion of the entire password surface. Repo is email+password-free at the end of this phase.

### Changes Required:

#### 1. Minimal signin page

**File**: `src/pages/auth/signin.astro`

**Intent**: Drop the `SignInForm` island; render a static card with a "Zaloguj przez Google" POST form and inline `?error=` display (the `ServerError` component is being deleted — inline the markup).

**Contract**: `<form method="post" action="/api/auth/signin">` with a single submit button; error paragraph rendered when `Astro.url.searchParams.get("error")` is non-null. No React island — pure Astro.

#### 2. Landing page button (FR-001)

**File**: `src/components/Welcome.astro`

**Intent**: Replace the "Sign In" / "Sign Up" link pair (lines 42-51) with one "Zaloguj przez Google" POST form (same contract as the signin page button).

**Contract**: same POST form as above; remove `/auth/signup` link entirely.

#### 3. Topbar links

**File**: `src/components/Topbar.astro`

**Intent**: For signed-out users, drop the Sign Up link; keep the Sign In link pointing at `/auth/signin`. Signed-in branch unchanged.

**Contract**: anchor list at lines 24-33 loses the signup entry.

#### 4. Middleware bounce

**File**: `src/middleware.ts`

**Intent**: Signed-in users hitting auth pages get redirected to the dashboard (decision: Bounce).

**Contract**: new `AUTH_ROUTES = ["/auth"]` prefix check — if `locals.user` is set and pathname starts with an auth route, `redirect("/dashboard")`. Must run AFTER user resolution; must NOT match `/api/auth/*` (the callback and signout live there) — match on `/auth/` page prefix only.

#### 5. Delete password surface

**File**: `src/pages/api/auth/signup.ts`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`, `src/components/auth/SignInForm.tsx`, `src/components/auth/SignUpForm.tsx`, `src/components/auth/FormField.tsx`, `src/components/auth/PasswordToggle.tsx`, `src/components/auth/SubmitButton.tsx`, `src/components/auth/ServerError.tsx`

**Intent**: Remove all email+password code and now-orphaned form components (decision: Sprzątanie — git history preserves them; S-03 will likely use shadcn forms instead).

**Contract**: `src/components/auth/` directory ends up empty (delete it); no dangling imports (build catches them).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes (catches dangling imports): `npm run build`
- No password-auth references remain: `grep -ri "signInWithPassword\|SignUpForm\|signup\|confirm-email" src/` returns nothing auth-related

#### Manual Verification:

- Landing page shows "Zaloguj przez Google"; full flow works from it (FR-001)
- `/auth/signin` renders the minimal page; error param displays inline
- Signed-in user visiting `/auth/signin` is bounced to `/dashboard`; `/api/auth/signout` still works (not caught by the bounce)
- `/auth/signup` and `/auth/confirm-email` return 404

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Deploy verification + docs

### Overview

Prove the flow on real workerd (the known cookie-friction risk), wire up production URLs, document provider setup.

### Changes Required:

#### 1. Production URL registration (manual, user-performed)

**File**: — (Supabase dashboard + Google Cloud Console)

**Intent**: Allow-list the deployed app so the OAuth round-trip works in production.

**Contract**: Supabase dashboard → Auth → URL Configuration: site URL = prod origin, redirect URLs += `https://<prod-origin>/api/auth/callback`. Google Console → Authorized JavaScript origins += prod origin. (Prod origin = `https://10xcards30.<account>.workers.dev` or the custom domain — confirm from Cloudflare dashboard / `context/foundation/project_deploy_status`.)

#### 2. README provider-setup section

**File**: `README.md`

**Intent**: Document Google OAuth setup (Console steps, dashboard steps, local `config.toml` + secret env var) in the existing "Supabase Configuration" section, and update the deploy section with the prod allow-list step. Note that no new app env vars are needed.

**Contract**: new subsection under Supabase Configuration; deploy section gains one step. Remove any email-confirmation toggle instructions (lines ~132-134) — obsolete.

#### 3. Deploy

**File**: — (`npx wrangler deploy`)

**Intent**: Ship phases 1-2 to Cloudflare Workers and verify on workerd.

**Contract**: existing deploy procedure per README; no wrangler config changes needed (no new secrets).

### Success Criteria:

#### Automated Verification:

- CI green on the pushed branch (lint + build with repo secrets)

#### Manual Verification:

- Full OAuth flow on the deployed URL: landing → Google → `/dashboard`, Topbar shows email (workerd cookie risk check — infrastructure.md:60)
- Session persists across reloads on prod; sign-out works on prod
- Error path on prod: cancel consent → `/auth/signin?error=...`

**Implementation Note**: After completing this phase and manual verification passes, F-02 is done — update roadmap status and archive via `/10x-archive`.

---

## Testing Strategy

### Unit Tests:

- None — no test runner in the project yet (introduced in Module 3). Revisit SRS/auth test coverage then.

### Integration Tests:

- None automated; CI covers lint + build.

### Manual Testing Steps:

1. Local: full happy path (landing button → consent → dashboard), reload persistence, sign-out.
2. Local: denial path (cancel consent), malformed callback (`/api/auth/callback` bare), missing env vars (`createClient` null branch → error redirect).
3. Signed-in bounce: visit `/auth/signin` with active session → `/dashboard`.
4. Prod (Phase 3): repeat 1-3 on the deployed Worker.

## Performance Considerations

None material — two extra redirects per sign-in are inherent to OAuth; middleware cost unchanged.

## Migration Notes

Existing email+password test accounts become unreachable (roadmap F-02 risk — accepted, no production users). No data migration. If a test account's email matches the Google account email, Supabase may link or create anew depending on project settings — irrelevant pre-launch; fresh accounts are fine.

## References

- Related research: `context/changes/google-oauth-switch/research.md`
- External API digest: `context/changes/google-oauth-switch/supabase-oauth.md`
- Existing endpoint pattern: `src/pages/api/auth/signout.ts`
- Cookie adapter: `src/lib/supabase.ts:5-23`
- Middleware: `src/middleware.ts:4-22`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: OAuth flow backend + provider config

#### Automated

- [ ] 1.1 Lint passes: `npm run lint`
- [ ] 1.2 Build passes: `npm run build`
- [ ] 1.3 Local Supabase restarts cleanly with new config

#### Manual

- [ ] 1.4 Full local flow lands on /dashboard with user populated
- [ ] 1.5 Session persists across reload; sign-out works
- [ ] 1.6 Consent denial lands on /auth/signin?error= with message
- [ ] 1.7 Bare /api/auth/callback redirects with invalid_callback error

### Phase 2: UI switch + email+password removal

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 Build passes: `npm run build`
- [ ] 2.3 No password-auth references remain in src/

#### Manual

- [ ] 2.4 Landing button works end-to-end (FR-001)
- [ ] 2.5 /auth/signin minimal page renders; error param displays
- [ ] 2.6 Signed-in bounce works; /api/auth/signout unaffected
- [ ] 2.7 /auth/signup and /auth/confirm-email return 404

### Phase 3: Deploy verification + docs

#### Automated

- [ ] 3.1 CI green on pushed branch

#### Manual

- [ ] 3.2 Full OAuth flow works on deployed Worker (workerd cookies OK)
- [ ] 3.3 Prod session persistence + sign-out verified
- [ ] 3.4 Prod error path verified
