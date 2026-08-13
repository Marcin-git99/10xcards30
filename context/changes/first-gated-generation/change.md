---
change_id: first-gated-generation
title: Generate flashcards from pasted text via OpenRouter, review, and save
status: implementing
created: 2026-08-13
updated: 2026-08-13
archived_at: null
---

## Notes

Roadmap slice S-01. Prerequisites F-01+F-02 done. LLM provider decided 2026-08-13:
OpenRouter, model `openai/gpt-4o-mini` — precedent in Marcin's prior course project
`10x-cards` (see memory `reference-openrouter-from-10xcards`), including a written
implementation plan at `.ai/openrouter-service-implementation-plan.md` in that repo.

Do not port 1:1 — this repo differs in secrets handling (`astro:env/server`, not
`import.meta.env`) and runtime (Cloudflare Workers/workerd, not Node).

Open unknowns from roadmap.md:

- Retry storm handling: LLM fails to return exactly 5 cards 3x in a row for the same
  input — infinite retry vs. "try a different excerpt" message? Owner: Marcin, non-blocking.
- PRD Guardrail 2: source text must not leave a trace in operator-accessible storage.
  OpenRouter may log prompts depending on account privacy settings — verify before
  first real API call, not assumed safe by default.

`OPENROUTER_API_KEY` goes in `.dev.vars` locally (workerd doesn't read `.env`) and via
`wrangler secret put` on production, same pattern as `SUPABASE_URL`/`SUPABASE_KEY`.
