---
bootstrapped_at: 2026-06-03T20:33:49Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: 10xcards30
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

Verbatim copy of `context/foundation/tech-stack.md`:

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10xcards30
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack

Solo developer building 10xCards — a web-app for AI-assisted flashcard generation with Leitner-light spaced repetition — under a 4-week after-hours timeline. Standard path: 10x-astro-starter is the recommended default for `(web, js)` and is purpose-built for this profile, bundling OAuth, Postgres, and edge deploy out of the box — the three plumbing pieces the PRD's FR-001 through FR-005 would otherwise force from scratch. The `has_ai` flag is set because of the synchronous LLM generation step (FR-006 to FR-014); the Cloudflare Pages adapter's edge runtime naturally enforces the PRD's 30-second hard cutoff. All four agent-friendly gates clear (TypeScript + Zod typing, opinionated conventions, mainstream JS community, current docs). Bootstrapper confidence is first-class — expect mostly-smooth scaffolding with occasional manual steps. CI choices (GitHub Actions + auto-deploy-on-merge) record the post-MVP pipeline shape; the PRD explicitly defers automated CI/CD to v2, so the first deploy stays manual per the Non-Goal.

## Pre-scaffold verification

| Signal             | Value                                                      | Severity | Notes                                       |
| ------------------ | ---------------------------------------------------------- | -------- | ------------------------------------------- |
| npm package        | not run                                                    | n/a      | cmd_template starts with `git clone`; no npm CLI to check |
| GitHub repo        | przeprogramowani/10x-astro-starter last pushed 2026-05-17  | fresh    | from card.docs_url; 17 days old at run time |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0 (final, after Windows SSL workarounds noted below)
**Files moved**: 20 (including `node_modules/`)
**Conflicts (.scaffold siblings)**: `CLAUDE.md.scaffold`, `package-lock.json.scaffold`
**.gitignore handling**: moved silently (no prior `.gitignore` in cwd)
**.bootstrap-scaffold cleanup**: deleted

### Environment workarounds applied

The Windows environment's Node.js bundled CA could not verify GitHub's and the npm registry's TLS certs. Two per-invocation workarounds were applied (no global config changed):

1. `git -c http.sslBackend=schannel clone …` — used Windows native cert store for the clone after a default `git clone` failed with "SSL certificate problem: unable to get local issuer certificate".
2. `NODE_OPTIONS="--use-system-ca" npm install` — used Node 22's `--use-system-ca` flag after a default `npm install` failed with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` on every tarball.

Both are the OS-trust-store equivalent of the default code paths. No global git or npm config was modified. If you re-run any npm command and hit the same SSL error, prefix it with `NODE_OPTIONS="--use-system-ca"` or set `NODE_OPTIONS=--use-system-ca` in your shell profile.

### Conflict matrix details

| Path in scaffold | Existed in cwd? | Resolution                                                                          |
| ---------------- | --------------- | ----------------------------------------------------------------------------------- |
| `CLAUDE.md`      | yes (7126 B)    | existing wins; scaffold copy (3218 B) landed as `CLAUDE.md.scaffold`                |
| `package-lock.json` | yes (87 B)   | existing wins; scaffold copy (475 894 B) landed as `package-lock.json.scaffold`     |
| all other paths  | no              | moved silently into cwd                                                              |
| `context/**`     | n/a             | scaffold ships no `context/` — your `context/` is untouched                          |

### Files now present in cwd from the scaffold

`.env.example`, `.github/`, `.gitignore`, `.husky/`, `.nvmrc`, `.prettierrc.json`, `.vscode/`, `CLAUDE.md.scaffold`, `README.md`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules/`, `package-lock.json.scaffold`, `package.json`, `public/`, `src/`, `supabase/`, `tsconfig.json`, `wrangler.jsonc`.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW (total 10)
**Direct vs transitive**: 0/0/2/0 direct of total 0/1/9/0 (2 of the 10 advisories are direct dependencies; 8 are transitive)

### Lockfile-mismatch caveat

The audit above was run against `package-lock.json.scaffold` after temporarily swapping it in (and reverted afterwards). When run against the active `package-lock.json` (the 87-byte stub the conflict matrix preserved), npm audit reports 0 findings because there is essentially nothing to audit. **Until you reconcile the two lockfiles, `npm audit` and `npm ci` from cwd will not match the installed `node_modules/`.** The recommended reconciliation is to replace the stub `package-lock.json` with `package-lock.json.scaffold`, or to delete both and re-run `npm install`.

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** (transitive) — Svelte devalue: DoS via sparse array deserialization. Advisory: GHSA-77vg-94rm-hx3p. CVSS 7.5 (CVE category: CWE-770). Range `>=5.6.3 <=5.8.0`. Pulled in via the SvelteKit-related tooling chain. Fix: upstream patch in 5.8.1+; `npm audit fix` should resolve.

#### MODERATE findings

- **@astrojs/check** (direct) — pulled in via `@astrojs/language-server`. Range `>=0.9.3`. Fix available as `@astrojs/check@0.9.2` (semver-major).
- **@astrojs/language-server** (transitive) — via `volar-service-yaml`. Effects `@astrojs/check`. Fix via the `@astrojs/check` major bump.
- **@cloudflare/vite-plugin** (transitive) — via `miniflare`, `wrangler`, `ws`. Range `<=0.0.0-fff677e35 || 0.0.7 - 1.37.2`. Fix available.
- **wrangler** (direct) — via `miniflare`. Fix available.
- Plus 5 additional moderate transitive findings clustered around the `wrangler` / `miniflare` / Cloudflare chain (`miniflare`, `volar-service-yaml`, plus three siblings). The full advisory list per package is in the raw `npm audit --json` output that was inspected during this run.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                       | Value                              |
| -------------------------- | ---------------------------------- |
| bootstrapper_confidence    | first-class                        |
| quality_override           | false                              |
| path_taken                 | standard                           |
| self_check_answers         | null                               |
| team_size                  | solo                               |
| deployment_target          | cloudflare-pages                   |
| ci_provider                | github-actions                     |
| ci_default_flow            | auto-deploy-on-merge               |
| has_auth                   | true                               |
| has_payments               | false                              |
| has_realtime               | false                              |
| has_ai                     | true                               |
| has_background_jobs        | false                              |

A future M1L4 ("Memory Architecture") skill is expected to consume these hints when generating `CLAUDE.md` / `AGENTS.md`. v1 bootstrapper surfaces them here without acting on them.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:

- Reconcile the lockfiles. `package-lock.json` is an 87-byte stub from before bootstrap; `package-lock.json.scaffold` matches `node_modules/`. Replace the former with the latter (or delete both and re-run `npm install`) before running `npm ci` or `npm audit` again.
- Diff `CLAUDE.md` (your prior project instructions, 7126 B) against `CLAUDE.md.scaffold` (the starter's, 3218 B) and decide which content to keep. The starter version has Astro-specific guidance; yours has the 10xDevs bootstrap-chain context. A merge is the likely outcome.
- `git init` is **not** needed — `.git/` already existed in cwd from before bootstrap; the cloned `.git/` from the starter was deleted to keep your history clean.
- Address audit findings per your risk tolerance. The 1 HIGH (`devalue`) and 2 direct MODERATE (`@astrojs/check`, `wrangler`) are the immediately-actionable surface. `npm audit fix` will resolve most; `npm audit fix --force` includes the semver-major bumps.
- Set the Supabase + Cloudflare env vars per `.env.example` before first run — the `has_auth: true` and edge-runtime defaults assume both are configured.
