---
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
---

## Why this stack

Solo developer building 10xCards — a web-app for AI-assisted flashcard generation with Leitner-light spaced repetition — under a 4-week after-hours timeline. Standard path: 10x-astro-starter is the recommended default for `(web, js)` and is purpose-built for this profile, bundling OAuth, Postgres, and edge deploy out of the box — the three plumbing pieces the PRD's FR-001 through FR-005 would otherwise force from scratch. The `has_ai` flag is set because of the synchronous LLM generation step (FR-006 to FR-014); the Cloudflare Pages adapter's edge runtime naturally enforces the PRD's 30-second hard cutoff. All four agent-friendly gates clear (TypeScript + Zod typing, opinionated conventions, mainstream JS community, current docs). Bootstrapper confidence is first-class — expect mostly-smooth scaffolding with occasional manual steps. CI choices (GitHub Actions + auto-deploy-on-merge) record the post-MVP pipeline shape; the PRD explicitly defers automated CI/CD to v2, so the first deploy stays manual per the Non-Goal.
