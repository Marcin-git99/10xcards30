---
project: 10xcards30
deployed_at: 2026-06-05
platform: Cloudflare Workers
live_url: https://10xcards30.turolmar1-775.workers.dev
version_id: 027327c3-e367-43cc-8aa4-70267002eb2c
worker_name: 10xcards30
account: turolmar1@gmail.com
---

## Pierwsze wdrożenie — audyt

### Status
✅ Wdrożone pomyślnie 2026-06-05.

### Wykonane kroki

1. **wrangler.jsonc** — zmieniono `name` z `10x-astro-starter` na `10xcards30`
2. **Cloudflare Workers Secrets** — ustawiono przez `wrangler secret put`:
   - `SUPABASE_URL` — Project URL projektu Supabase `10xCards30`
   - `SUPABASE_KEY` — anon/public key projektu Supabase `10xCards30`
3. **Build** — `npm run build` (exit code 0)
4. **Deploy** — `npx wrangler deploy` (exit code 0)

### Parametry wdrożenia

| Parametr | Wartość |
|---|---|
| Live URL | https://10xcards30.turolmar1-775.workers.dev |
| Version ID | 027327c3-e367-43cc-8aa4-70267002eb2c |
| Bundle (raw) | 1971.74 KiB |
| Bundle (gzip) | 401.34 KiB |
| Worker Startup Time | 25 ms |
| Plan | Workers Free |

### Zasoby automatycznie sprovisionowane przez Wrangler

- **KV Namespace** `10xcards30-session` (ID: `96bed4360a694273bbcef0752ffa380e`) — dla Astro sessions binding `env.SESSION`

### Supabase

- Projekt: `10xCards30` (AWS eu-central-1, NANO)
- Migracja zastosowana: `20260604000000_create_cards.sql` (tabela `cards` z RLS)
- Status: ACTIVE / Healthy

### Uwagi operacyjne

- `workers_dev` jest włączone (domyślne dla MVP) — aplikacja dostępna pod `*.workers.dev`
- Preview URLs włączone domyślnie
- Wrangler zapisał ID KV Namespace do `.wrangler/deploy/config.json` — nie commitować tego pliku
- Rollback: `npx wrangler rollback` (listuje poprzednie deployment ID)
- Logi: `npx wrangler tail 10xcards30` (wymaga ustawionego `CLOUDFLARE_API_TOKEN`)

### Znane ograniczenia (free tier)

- CPU limit: 10ms per request (wystarczy dla MVP przy niskim ruchu)
- Subrequest limit: 50/invocation
- Bundle limit: 3MB (aktualny: ~2MB — jest margines)
- Sygnał do upgrade ($5/mies.): błędy `1027: Worker exceeded CPU time limit` w logach
