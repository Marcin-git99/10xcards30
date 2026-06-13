# External research: Supabase Google OAuth (PKCE, SSR) — API digest

> Fetched 2026-06-11 via WebFetch from supabase.com/docs (live docs, not model memory).
> Sources:
> - https://supabase.com/docs/guides/auth/social-login/auth-google
> - https://supabase.com/docs/reference/javascript/auth-signinwithoauth
> - https://supabase.com/docs/reference/javascript/auth-exchangecodeforsession
> - https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=astro

## Flow (server-side PKCE)

1. **Initiation** — server route calls:

```js
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: "google",
  options: {
    redirectTo: "http://example.com/auth/callback", // app callback, must be allow-listed
  },
});
// data: { url?: string, provider: string }  → redirect the browser to data.url
```

Options also support `scopes` (space-separated string) and `queryParams`. The SSR client writes the `code_verifier` cookie during this call — initiation MUST go through the same `createServerClient` cookie adapter as the rest of the app.

2. **Callback** — app route receives `?code=`, exchanges it:

```js
const { data, error } = await supabase.auth.exchangeCodeForSession(code);
// data: { session, user }; error on failure
// PKCE-only method; session cookies written via the client's setAll
```

## Astro SSR client (official pattern)

Docs' canonical Astro cookie adapter matches our `src/lib/supabase.ts` almost exactly (`parseCookieHeader` for getAll, `context.cookies.set` for setAll; requires `output: "server"`). Two cosmetic deltas, no action needed:
- docs read env via `import.meta.env.PUBLIC_SUPABASE_URL` — we use `astro:env/server` (stricter, fine);
- docs name the key `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (new key naming; legacy anon key still works as our `SUPABASE_KEY`).

## Google Cloud Console setup

- Create OAuth client: type **Web application** (console.cloud.google.com/auth/clients/create).
- **Authorized JavaScript origins**: app base URL (`https://<app-domain>`); add `http://localhost:<port>` for local dev (remove before prod).
- **Authorized redirect URIs**: the **Supabase** callback, not the app's:
  - hosted: `https://<project-ref>.supabase.co/auth/v1/callback`
  - local CLI: `http://127.0.0.1:54321/auth/v1/callback`
- Scopes (Data Access): `openid` (add manually), `userinfo.email`, `userinfo.profile` (defaults).

## Supabase provider config

- Dashboard: Client ID + Client Secret at `…/auth/providers?provider=Google` (hosted project).
- Local `supabase/config.toml`:

```toml
[auth.external.google]
enabled = true
client_id = "<client-id>"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"
skip_nonce_check = false
```

with `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET` in the env the CLI reads.
- Multiple client IDs (web/iOS/Android): comma-concatenated, web first. (N/A for MVP.)

## Discrepancies / watch-outs

- **`skip_nonce_check`**: current Google guide example shows `false`; the apple-template comment in our `supabase/config.toml:315-316` claims `true` is "Required for local sign in with Google auth". Resolve empirically during local testing — start with `false`, flip only if local sign-in fails on nonce.
- The old "OAuth with PKCE flow for SSR" guide page no longer carries implementation code — the per-provider guide + JS reference above are the current sources.
- App-side `redirectTo` must ALSO be allow-listed in Supabase (`additional_redirect_urls` locally / Auth URL configuration in dashboard) — current config.toml values are stale (port 3000, https on localhost).
