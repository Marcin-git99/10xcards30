---
date: 2026-06-11T21:28:48+02:00
researcher: Claude (Fable 5)
git_commit: eba717070e4bcfde1cdcc4a09c87fc4915c3fe4d
branch: main
repository: 10xCards
topic: "Map the current auth implementation end-to-end: everything the switch to Google OAuth (PKCE flow) will touch or remove"
tags: [research, codebase, auth, supabase, oauth, middleware, cloudflare]
status: complete
last_updated: 2026-06-11
last_updated_by: Claude (Fable 5)
---

# Research: Current auth implementation vs Google OAuth switch (F-02)

**Date**: 2026-06-11T21:28:48+02:00
**Researcher**: Claude (Fable 5)
**Git Commit**: eba717070e4bcfde1cdcc4a09c87fc4915c3fe4d
**Branch**: main
**Repository**: 10xCards

## Research Question

Map the current auth implementation end-to-end: email+password endpoints, Supabase SSR client setup, middleware/session handling, auth pages, env config — everything the switch to Google OAuth (PKCE flow) will touch or remove.

## Summary

The current auth is fully server-side: React form islands POST to three API endpoints (`signin`, `signup`, `signout`), which call Supabase password methods through a per-request SSR client (`@supabase/ssr` cookie adapter). Middleware resolves the user with `getUser()` on every request and guards `/dashboard`. **There is no OAuth code anywhere** — no `signInWithOAuth`, no callback route, no `exchangeCodeForSession`, no canonical site URL, and no Google provider in `supabase/config.toml`.

The switch is therefore: **remove** the email+password surface (2 endpoints, 1 page, 2 form components + helpers), **keep** the session plumbing unchanged (SSR client, middleware, cookie adapter — already PKCE-ready since `createServerClient` defaults to PKCE flow), and **add** two small server routes (OAuth initiation + code-exchange callback) plus provider configuration in three places outside the repo (Google Cloud Console, Supabase dashboard, `config.toml` for local dev).

Key constraint from PRD: account identity must bind to the **stable external identifier** (FR-002) — Supabase handles this via `auth.users.id`, which all RLS policies already key on (`auth.uid()`), so the DB layer is provider-agnostic and needs no change.

## Detailed Findings

### 1. What gets REMOVED (email+password specific)

- `src/pages/api/auth/signin.ts:13` — `signInWithPassword({ email, password })` from FormData, redirect to `/` on success, `?error=` round-trip on failure. No zod validation (raw FormData).
- `src/pages/api/auth/signup.ts:13` — `signUp({ email, password })`, redirect to `/auth/confirm-email`. Whole endpoint obsolete (FR-002: auto-create on first OAuth sign-in, no registration flow).
- `src/pages/auth/signup.astro` — signup page; obsolete.
- `src/pages/auth/confirm-email.astro` — email-confirmation page; obsolete (US-01: "user is not asked to confirm an email").
- `src/components/auth/SignUpForm.tsx` (134 lines) — email/password/confirm validation.
- `src/components/auth/SignInForm.tsx` (87 lines) — replaced by a "Sign in with Google" button (form POST or link to initiation endpoint).
- `src/components/auth/PasswordToggle.tsx`, `FormField.tsx`, `SubmitButton.tsx`, `ServerError.tsx` — password-form helpers; FormField/SubmitButton/ServerError are generic but have no other consumers; removal candidates once forms go (S-03 may reintroduce form needs — decision for plan).

### 2. What STAYS unchanged (auth-generic plumbing)

- `src/lib/supabase.ts:5-23` — `createClient(requestHeaders, cookies)` using `createServerClient` + `parseCookieHeader`; cookie adapter reads the raw `Cookie` header and writes via `AstroCookies.set` with Supabase-supplied options. Returns `null` if `SUPABASE_URL`/`SUPABASE_KEY` unset (every caller null-checks). **No explicit `flowType` — `@supabase/ssr` defaults to PKCE**, so `signInWithOAuth` will set the `code_verifier` cookie through this same adapter.
- `src/middleware.ts:4-22` — `PROTECTED_ROUTES = ["/dashboard"]` (prefix match), `supabase.auth.getUser()` per request (server-validated, not `getSession()`), `context.locals.user = user ?? null`, redirect to `/auth/signin`. Implicit token refresh happens here (expired token → `getUser()` triggers refresh → new cookies via `setAll`).
- `src/pages/api/auth/signout.ts:7` — `signOut()` + redirect to `/`; provider-agnostic, satisfies FR-004 as-is.
- `src/env.d.ts` — `App.Locals.user: User | null`; no change needed.
- `src/pages/api/cards.ts:14-20` — 401 gate on `locals.user`; untouched.
- UI auth-state consumers: `src/components/Topbar.astro:2,11-33` (user.email, signout form, signin/signup links), `src/components/Welcome.astro:42-51` (Sign In / Sign Up buttons), `src/pages/dashboard.astro:7,26-28` — links/labels need updating (drop signup), logic stays.

### 3. What gets ADDED (missing for PKCE OAuth)

Confirmed absent (case-insensitive grep over `src/`): `signInWithOAuth`, `exchangeCodeForSession`, `callback`, `flowType`, `pkce`, `code_verifier` — zero matches.

1. **OAuth initiation endpoint** — server-side route calling `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: <origin>/<callback-path> } })` and redirecting to `data.url`. Must run through the SSR client so the `code_verifier` cookie is written.
2. **Callback route** — GET handler reading `?code=`, calling `supabase.auth.exchangeCodeForSession(code)`, handling `?error=`/`?error_description=`, then redirecting (e.g. to `/dashboard`). Path convention open: `/api/auth/callback` (matches this repo's API layout) vs `/auth/callback` (Supabase docs convention) — see Open Questions.
3. **Canonical origin** — `astro.config.mjs` has no `site`; `redirectTo` must derive from `context.url.origin` (works locally + workers.dev) or a new env schema entry.
4. **Landing-page button** — FR-001: "Zaloguj przez Google" on landing page (`Welcome.astro` / `signin.astro`).

### 4. Environment & deploy plumbing

- `astro.config.mjs:11-22` — `output: "server"`, `adapter: cloudflare()` (no options), env schema: `SUPABASE_URL` + `SUPABASE_KEY` (server, secret, optional).
- `wrangler.jsonc:4` — worker `10xcards30`, `nodejs_compat`, no `vars` block; prod secrets via dashboard / `wrangler secret put`; local via `.dev.vars` (workerd ignores `.env`).
- `.github/workflows/ci.yml:22-24` — build consumes `SUPABASE_URL`/`SUPABASE_KEY` repo secrets; a new non-optional env var would need a new GitHub secret.
- `supabase/config.toml:150-156` — `site_url = "http://127.0.0.1:3000"`, `additional_redirect_urls = ["https://127.0.0.1:3000"]` — **both look stale** (Astro dev runs on 4321; https on localhost; no callback path). **No `[auth.external.google]` section** (only a disabled apple template at :305-318, whose comments note `skip_nonce_check = true` is required for local Google sign-in).
- `supabase/.temp/linked-project.json` — CLI linked to a hosted project ⇒ provider must be configured in the hosted dashboard too, not just config.toml.
- Out-of-repo manual steps (roadmap F-02 risk, roadmap.md:85): Google Cloud Console OAuth credentials with redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`; Supabase dashboard: enable Google provider + allow-list app callback URL.

### 5. PRD/foundation constraints binding the implementation

- FR-001 (prd.md:164) — sign-in initiated from the landing page.
- FR-002 (prd.md:165-166, US-01 acceptance :71-73) — auto-create on first sign-in, reconnect by **stable external identifier**, zero extra onboarding steps (no email confirm, no password).
- FR-003 (prd.md:166) — session persists across reloads until sign-out/delete; current SSR cookie setup already satisfies this.
- US-03 (prd.md:88-92) — after account deletion, re-sign-in with the same Google profile = fresh account; identity anchor is `auth.users.id`, recreated by Supabase on re-auth.
- Access control (prd.md:224-242) — single OAuth provider, **no** email+password, password reset, email verification, or second provider in MVP.
- RLS (migrations `20260604000000_create_cards.sql`, `20260609211146_reshape_schema_to_prd_model.sql:20-28`) — all policies check `user_id = auth.uid()` on the `authenticated` role; provider-agnostic, no DB change needed.
- infrastructure.md:60 — known friction: `@supabase/ssr` cookie serialization differs in workerd vs Node; OAuth redirect + cookie flow must be verified on deployed Workers, not just local dev.

## Code References

- `src/lib/supabase.ts:5-23` — SSR client factory + cookie adapter (stays; PKCE-ready)
- `src/middleware.ts:4-22` — PROTECTED_ROUTES, getUser(), locals.user, redirect (stays)
- `src/pages/api/auth/signin.ts:13` — signInWithPassword (remove/replace)
- `src/pages/api/auth/signup.ts:13` — signUp (remove)
- `src/pages/api/auth/signout.ts:7` — signOut (stays)
- `src/pages/auth/signin.astro:16` — renders SignInForm (rework to Google button)
- `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro` — remove
- `src/components/auth/*.tsx` — SignInForm:43, SignUpForm:66 POST to api endpoints (remove/rework)
- `src/components/Topbar.astro:11-33`, `src/components/Welcome.astro:42-51` — auth links/labels (update)
- `src/pages/dashboard.astro:7,26-28` — locals.user consumer (stays)
- `src/pages/api/cards.ts:14-20` — 401 gate (stays)
- `src/env.d.ts:1-5` — Locals typing (stays)
- `astro.config.mjs:11-22` — adapter + env schema (extend if site URL var added)
- `wrangler.jsonc:4` — worker name 10xcards30
- `supabase/config.toml:150-156,305-318` — auth config, no google provider yet
- `.github/workflows/ci.yml:22-24` — build secrets

## Architecture Insights

- **All auth is server-side** — no `createBrowserClient` anywhere; forms POST to API routes. The OAuth flow should follow the same pattern: initiation and exchange both server-side through the SSR client, which keeps the `code_verifier` cookie handling in one place.
- **Per-request client creation** — every endpoint/middleware re-creates the client from `(headers, cookies)`; the client is deliberately not on `locals`. The callback route should follow this convention.
- **`getUser()` over `getSession()`** everywhere — server-validated identity; keep it.
- **Error round-trip via `?error=` query param** to the auth page — the callback route can reuse this convention for provider errors.
- **Auth pages don't bounce signed-in users** — `/auth/signin` renders the form even with an active session; worth fixing in F-02 since post-OAuth landing UX matters now.
- **No `?next=` return-to param** in middleware redirects — users always land on a hardcoded path after sign-in.

## Historical Context (from prior changes)

- `context/archive/2026-06-09-db-schema-mvp/plan.md:66-67` — account deletion cascades via the `auth.users` FK at DB level (bypasses RLS); no user-facing DELETE policy needed on `generations`. Provider-agnostic — confirms F-02 needs no schema work.
- `context/foundation/roadmap.md:75-86` — F-02 scope, risk: provider switch resets existing email+password test accounts (acceptable pre-launch); callback URL must be manually added in Google Cloud Console before prod works.
- `context/foundation/infrastructure.md:60,132-133` — workerd cookie friction warning; secrets via `wrangler secret put`.
- `context/changes/bootstrap-verification/`, `context/changes/lint-debt-cleanup/` — nothing auth-related.

## Related Research

- None yet — this is the first `research.md` in `context/changes/`.

## Open Questions

1. **Callback route path**: `/api/auth/callback.ts` (consistent with this repo's API route layout and uppercase-handler convention) vs `/auth/callback` (Supabase docs convention, page route). Needs a decision in `/10x-plan`; affects Supabase dashboard allow-list entries.
2. **Initiation shape**: dedicated `GET /api/auth/signin` redirect endpoint vs form POST — current convention is POST forms; a plain link/redirect is simpler for OAuth.
3. **Fate of generic form components** (`FormField`, `SubmitButton`, `ServerError`): delete now or keep for S-03 manual-card forms? No other consumers today.
4. **Canonical origin source**: `context.url.origin` (zero config, but trusts Host header) vs explicit `SITE_URL` env var (one more secret in CI + wrangler). Workers deployment behind workers.dev makes origin derivation generally safe.
5. **Stale `supabase/config.toml` values**: `site_url` port 3000 and https `additional_redirect_urls` predate this project's dev setup — fix alongside the google provider block, and document Astro dev port 4321.
6. **Signed-in users on `/auth/signin`**: add middleware bounce (`locals.user` → redirect `/dashboard`) as part of F-02 or defer?
