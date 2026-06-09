<!-- PLAN-REVIEW-REPORT -->
# Plan Review: DB Schema Migration to PRD Model (F-01)

- **Plan**: context/changes/db-schema-mvp/plan.md
- **Mode**: Deep
- **Date**: 2026-06-09
- **Verdict**: REVISE → SOUND (after triage)
- **Findings**: 1 critical · 1 warning · 1 observation (all fixed)

## Verdicts

| Dimension | Verdict (initial) | After fixes |
|-----------|-------------------|-------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

4/4 paths ✓, 3/3 symbols ✓, brief↔plan ✓, blast-radius: +2 unlisted `Card` consumers ✗ (resolved by F1). Progress↔Phase consistent.

## Findings

### F1 — Phase 2 misses two Card consumers; rename breaks the app

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — App-code sync
- **Detail**: Phase 2 named only `types.ts` + `api/cards.ts`. Blast-radius grep found `front`/`back`/`Card` also used in `src/components/cards/CardsSection.tsx:39-40` (renders `card.front`/`card.back` → `undefined` after rename) and `src/components/cards/CreateCardForm.tsx:12-13,38` (front/back state + POSTs `{ front, back }` → endpoint 422). `dashboard.astro` imports `Card` type-only (fine).
- **Fix**: Expanded Phase 2 to the full rename blast radius — added CardsSection.tsx (#3) and CreateCardForm.tsx (#4); updated Current State Analysis to document all 4 files; broadened manual criterion 2.5 to an end-to-end UI check.
- **Decision**: FIXED (Fix in plan)

### F2 — Automated verification can't catch an incomplete rename

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Success Criteria
- **Detail**: `npm run build` = `astro build` (esbuild strips types without checking); no `typecheck`/`astro check` script existed; eslint won't flag missing-property access. So criteria 2.1+2.2 would pass even with the F1 bug. `@astrojs/check` is installed but unwired.
- **Fix**: Added Phase 2 change #5 — wire `"check": "astro check"` in package.json; added `npm run check` as the first automated verification step (Progress 2.1).
- **Decision**: FIXED (Fix A — astro check)

### F3 — "Complete RLS" wording vs intentionally partial policies

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — generations RLS
- **Detail**: Roadmap says "RLS kompletne"; plan gives `generations` only INSERT + SELECT (no UPDATE — immutable; no DELETE — cascade). Defensible but could read as an omission.
- **Fix**: Strengthened the Phase 1 contract note to tie the partial policy set explicitly to the roadmap's "kompletne" intent (every app-performed op is policed; others denied by default-deny).
- **Decision**: FIXED (Fix in plan)
