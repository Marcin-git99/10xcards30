---
project: 10xcards30
researched_at: 2026-06-05
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 SSR
  runtime: Cloudflare Workers (workerd / edge)
  database: Supabase (external managed Postgres)
  ai_gateway: OpenRouter (external)
---

## Recommendation

**Deploy on Cloudflare Workers.**

Astro 6 ships `@astrojs/cloudflare` v13.6.1 as a first-class adapter with native workerd runtime support — `astro dev` already runs against the real Workers runtime in development, giving production parity from day one. The project's `wrangler.jsonc` is already configured (`main: "@astrojs/cloudflare/entrypoints/server"`), so no adapter migration is needed. Combined with wrangler CLI (the only CLI in the shortlist with Pass scores on all five agent-friendly criteria), zero egress charges, and an available MCP server (`mcp.cloudflare.com/mcp`), Cloudflare Workers is the strongest fit for this stack. Developer familiarity with the platform eliminates onboarding friction.

> **Note on tech-stack.md:** The file records `deployment_target: cloudflare-pages`. Cloudflare Pages (as a separate product) is being deprecated — all new Astro 6 deployments go to Workers. The project's `wrangler.jsonc` is already correctly configured for Workers; no action needed beyond knowing the terminology shift.

---

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP | **Score** |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | ✅ Pass | **5/5** |
| Vercel | ✅ Pass | ✅ Pass | ✅ Pass | 🟡 Partial | 🟡 Partial (beta) | **4/5** |
| Netlify | 🟡 Partial | ✅ Pass | ✅ Pass | 🟡 Partial | 🟡 Partial | **3.5/5** |
| Fly.io | ✅ Pass | 🟡 Partial | 🟡 Partial | ✅ Pass | ❌ Fail | **3/5** |
| Railway | 🟡 Partial | 🟡 Partial | 🟡 Partial | 🟡 Partial | ❌ Fail | **2.5/5** |
| Render | ❌ Fail | 🟡 Partial | 🟡 Partial | 🟡 Partial | ❌ Fail | **2/5** |

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Native Astro 6 adapter (v13.6.1), wrangler CLI covers the full lifecycle (deploy, rollback, secrets, log tail, whoami), docs are well-structured and indexed. Zero egress fees make it cost-predictable for AI-heavy apps calling OpenRouter. MCP server at `mcp.cloudflare.com/mcp` enables agent-level observability. The 10ms CPU free tier is a known constraint for SSR workloads — plan to upgrade to paid ($5/mo) from the start.

#### 2. Vercel

Solid Astro support via `@astrojs/vercel`, excellent preview deploy UX (automatic per-PR), good CLI. Main gaps: 10s function timeout on free (insufficient for OpenRouter calls), $20/month for Pro tier, Vercel MCP is currently in beta. Would add `@astrojs/vercel` adapter swap overhead vs. the already-configured Cloudflare setup.

#### 3. Netlify

Stable platform with proven Astro support, built-in CI/CD with GitHub integration, and automatic preview URLs per branch. Weaker scoring on CLI-first (dashboard-heavy) and agent operability — no reliable way for an agent to tail runtime logs or manage secrets without browser interaction. No persistent MCP server.

---

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **10ms CPU limit on free tier is a real SSR blocker.** Cloudflare's own docs acknowledge that "heavier workloads handling authentication or server-side rendering typically consuming 10–20 ms." Paid tier ($5/mo) is the correct starting point for this project.
2. **Bundle size 3MB (compressed) on free.** Astro 6 + React 19 + shadcn/ui + Supabase-js + OpenRouter SDK is a significant bundle. 3MB free limit is tight; paid tier raises it to 10MB.
3. **50 subrequests/invocation on free.** Each `fetch()` to Supabase and OpenRouter counts. A page doing auth check + DB query + AI call in one render can approach the limit. Paid tier gives 10,000.
4. **workerd ≠ Node.js — npm compatibility friction.** CommonJS packages require pre-compilation. Errors surface only in workerd, not in local Node.js dev. Each new dependency needs a workerd compatibility check.
5. **`@supabase/ssr` + workerd cookies: known friction area.** Cookie serialization behaves differently in workerd vs. Node.js. The project's existing `src/middleware.ts` handles this, but any upgrade to `@supabase/ssr` warrants re-testing.

### Pre-Mortem — How This Could Fail

*Six months later, the Cloudflare decision created compounding pain.*

It started with free-tier 1027 errors at modest traffic — 10ms CPU wasn't enough for SSR + JWT validation. Paid ($5/mo) fixed it, but the bundle crept past 3MB after adding more shadcn components and a Markdown rendering library. A patch upgrade to `@astrojs/cloudflare` v14 introduced a breaking change in how `astro:env/server` exposes secrets, silently breaking the Supabase auth flow in production. Rollback with `wrangler rollback` took 40 minutes to diagnose. The root cause of the next incident: a dependency used `crypto.createHash` with a method that exists in Node.js but not in workerd's implementation of `nodejs_compat`. It worked locally and failed only in production — two days of debugging.

*The incorrect assumption from day 1: "nodejs_compat = full Node.js." It is not.*

### Unknown Unknowns

- **`deployment_target: cloudflare-pages` in tech-stack.md is already stale.** Cloudflare Pages is being deprecated as a separate product. Workers is the correct target. The project's `wrangler.jsonc` is already correct.
- **CPU time is not wall-clock time.** The 10ms limit counts processor cycles, not I/O wait. Supabase and OpenRouter `fetch()` calls do NOT count. Astro component rendering, Zod validation, and JWT parsing DO count.
- **`nodejs_compat` does not mean full Node.js.** `fs`, `child_process`, and `http` server are unavailable. Some `crypto` methods work, others do not. Validate each new dependency against `@cloudflare/workers-types`.
- **Preview deployments are not automatic per-PR out of the box.** Unlike Vercel/Netlify, Cloudflare Workers doesn't auto-create preview URLs from GitHub PRs without additional CI configuration. Manual `wrangler deploy` to a preview environment is the MVP approach.
- **Workers KV eventual consistency (60s propagation).** If Workers KV is used for sessions, writes are not immediately globally visible. For single-region MVP this is acceptable; for future multi-region rollout, design for eventual consistency.

---

## Operational Story

- **Preview deploys**: Manual via `wrangler deploy --env preview` to a named environment defined in `wrangler.jsonc`. No automatic per-PR preview URLs at MVP stage (no GitHub Actions pipeline yet — deferred to v2 per PRD). Preview URLs follow the pattern `<name>.<account>.workers.dev`.
- **Secrets**: Stored in Cloudflare Workers Secrets via `wrangler secret put <KEY>`. Never in `.dev.vars` (gitignored, local only) or committed code. Access scoped to the project. Rotation: `wrangler secret put <KEY>` overwrites; Cloudflare panel for emergency access.
- **Rollback**: `wrangler rollback [deployment-id]` — lists previous deployments, installs chosen version within ~30 seconds. No data-layer rollback (DB migrations via Supabase are separate, irreversible without explicit migration).
- **Approval**: Human required for: `wrangler secret put/delete` (rotating any secret), `wrangler delete` (deleting a Worker), Supabase schema migrations, and any DNS changes. Agent may perform unattended: `wrangler deploy`, `wrangler rollback`, `wrangler tail` (log streaming), `wrangler pages deployment list`.
- **Logs**: `wrangler tail <worker-name>` streams real-time logs to terminal. Historical logs: Cloudflare dashboard → Workers & Pages → project → Logs. Via MCP: `mcp.cloudflare.com/mcp` with `observability.mcp.cloudflare.com/mcp` for structured log queries.

---

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 10ms CPU limit causes 1027 errors on free tier for SSR + auth | Devil's Advocate | H | H | Start on Workers Paid ($5/mo) from first deploy — do not rely on free tier for production SSR |
| Bundle size exceeds 3MB (free) / 10MB (paid) compressed | Devil's Advocate | M | M | Run `wrangler deploy --dry-run` and check bundle size before each release; audit shadcn imports (use tree-shaking) |
| 50 subrequest limit hit on complex SSR pages (free tier) | Devil's Advocate | M | M | Paid tier (10,000 subreqs); avoid fan-out patterns on single render; use streaming where possible |
| npm package CJS incompatibility with workerd | Pre-mortem | M | H | Test each new dependency with `wrangler dev` before merging; check against Cloudflare's compatibility matrix |
| `@astrojs/cloudflare` adapter upgrade breaks auth flow | Pre-mortem | L | H | Pin adapter version in `package.json`; test upgrade in preview environment before production rollout |
| `nodejs_compat` gaps cause production-only errors | Unknown unknowns | M | M | Validate crypto/stream usage; keep `nodejs_compat` flag; document known-incompatible patterns in `context/foundation/lessons.md` |
| Preview deploys not automatic — manual deploy needed per PR | Unknown unknowns | H | L | Acceptable for MVP; add GitHub Actions `wrangler deploy --env preview` in v2 CI pipeline |
| Workers KV eventual consistency if used for sessions | Unknown unknowns | L | L | Use JWT-based sessions (Supabase default) for MVP; avoid KV-based sessions until multi-region is needed |

---

## Technical Decisions

| Decision | Value | Rationale |
|---|---|---|
| Runtime | Cloudflare Workers (workerd) | First-class Astro 6 support, production parity in dev |
| Plan | Workers Paid ($5/month) | 10ms free CPU insufficient for SSR + auth |
| Region | Auto (Cloudflare global edge) | Single-region fine for MVP; edge routing is transparent |
| Adapter | `@astrojs/cloudflare` v13.6.1 | Pinned; upgrade only in preview first |
| Secrets | Cloudflare Workers Secrets via `wrangler secret put` | SUPABASE_URL, SUPABASE_KEY, any future API keys |
| Local dev vars | `.dev.vars` (gitignored) | workerd reads `.dev.vars`, not `.env` |

---

## Signal to Change Decision

Revisit this decision (and consider migrating to Railway or a VPS) when:

- Monthly CPU ms costs on Workers Paid consistently exceed $20/month (high SSR load)
- A required npm dependency is fundamentally incompatible with workerd and has no alternative
- Long-running AI inference (>30s wall-clock) is needed (Workers max is 5 min CPU, 30s default — adjust with `--max-cpu-time` on paid)
- Background job scheduling (CRON) becomes a core feature — Workers Cron Triggers exist but require Durable Objects for stateful orchestration

---

## Getting Started

1. **Verify wrangler login**: `npx wrangler whoami` — must show your Cloudflare account.
2. **Add secrets** (run once before first deploy):
   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   ```
3. **Build and deploy**:
   ```bash
   npm run build
   npx wrangler deploy
   ```
4. **Verify deployment**: `npx wrangler deployments list` — check the live URL in output.
5. **Tail logs**: `npx wrangler tail` — streams real-time requests and errors.

> **Local dev**: Use `npm run dev` (runs against real workerd via `@astrojs/cloudflare` Vite plugin). Secrets go in `.dev.vars`, not `.env`.

---

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (deferred to v2 per PRD)
- Production-scale architecture (multi-region, HA, DR)
- Cloudflare D1 / R2 as Supabase replacement (external Supabase is the decided data layer)
