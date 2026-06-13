# LANE B — S-03 flashcard-library

> Notatka koordynacyjna pracy równoległej (m2l5). Worktree izoluje git, NIE środowisko.
> Dispatcher: `D:\projekty\10xCards`. Lane równoległy: A = `google-oauth-switch` (F-02).

## Tożsamość pasa

- **Branch:** `feature/flashcard-library`
- **Plan:** do utworzenia → `context/changes/flashcard-library/plan.md`
- **Slice (roadmap S-03):** „Moje fiszki" — lista kart (AI + manual) sortowana `created_at` desc,
  edycja Q/A bez resetu `leitner_box`/`next_review_at`, usuwanie z potwierdzeniem,
  ręczne tworzenie pustej karty (wykluczona z SRS dopóki Q i A nie wypełnione).
- **PRD refs:** US-07, FR-023–FR-026, FR-028. **Prereq:** F-01 (done).

## Reguły koordynacji środowiska (NIE łam)

- **Port dev:** uruchamiaj `npm run dev -- --port 4322`. (Lane A posiada 4321.)
- **Supabase lifecycle:** **NIE** uruchamiaj `supabase stop/start` — to własność lane A.
  Jeśli baza zniknie na chwilę, to lane A robi restart dla config Google — poczekaj.
- **Wspólna lokalna baza** (`localhost:54321/54322`) — ten pas **nie dodaje migracji**
  (używa schematu z F-01: tabele `cards`, `generations`).
- **Pliki współdzielone — ZAKAZ edycji:** `src/middleware.ts` i `src/components/Topbar.astro`
  są własnością lane A (F-02). Użyj własnej trasy `/library`; link w nawigacji **odłóż**
  na osobny mały slice po merge'u obu pasów.

## Po skończeniu

Solo Code Review (`/code-review`) → osobny PR z tego brancha.
