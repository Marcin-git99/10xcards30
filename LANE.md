# LANE — praca równoległa m2l5 (ZAMKNIĘTE 2026-08-09)

> Notatka koordynacyjna pracy równoległej (m2l5). Worktree izoluje git, NIE środowisko.
> Dispatcher: `D:\projekty\10xCards`.
>
> **Status: historyczny.** Oba pasy zostały zmergowane do `main` (PR #1 = F-02, PR #2 = S-03),
> więc poniższe reguły własności plików i portów już nie obowiązują. Plik zostaje jako zapis
> tego, jak podzielono pracę — nie jako instrukcja do wykonania.

---

## LANE A — F-02 google-oauth-switch

### Tożsamość pasa

- **Branch:** `feature/google-oauth-switch`
- **Plan:** `context/changes/google-oauth-switch/plan.md` (3 fazy, gotowy)
- **Tryb:** interaktywny — F-02 ma kroki manualne (Google Console, deploy).

### Reguły koordynacji środowiska (obowiązywały w trakcie m2l5)

- **Port dev:** ten pas posiadał domyślny **4321**. (Lane B używał 4322.)
- **Supabase lifecycle:** ten pas był właścicielem `npx supabase stop && npx supabase start`
  (potrzebne dla `supabase/config.toml` — provider Google). Restart robiony, gdy lane B NIE pisał do bazy.
- **Wspólna lokalna baza** (`localhost:54321/54322`) — jeden Docker dla obu pasów.
  Ten pas **nie dodawał migracji** (plan: „No DB/schema/RLS changes").
- **Pliki współdzielone:** ten pas **był właścicielem** edycji `src/middleware.ts` (bounce)
  i `src/components/Topbar.astro` (usunięcie linku signup).

### Kroki manualne (należą do Ciebie, nie do agenta)

- Google Cloud Console: OAuth client „Web application" + redirect URI Supabase.
- Supabase dashboard: włącz provider Google (Client ID + Secret).
- Sekret lokalnie: zmienna env czytana przez CLI (NIE `.dev.vars`).
- Deploy + weryfikacja na workerd (faza 3).

---

## LANE B — S-03 flashcard-library

### Tożsamość pasa

- **Branch:** `feature/flashcard-library`
- **Plan:** `context/changes/flashcard-library/plan.md`
- **Slice (roadmap S-03):** „Moje fiszki" — lista kart (AI + manual) sortowana `created_at` desc,
  edycja Q/A bez resetu `leitner_box`/`next_review_at`, usuwanie z potwierdzeniem,
  ręczne tworzenie pustej karty (wykluczona z SRS dopóki Q i A nie wypełnione).
- **PRD refs:** US-07, FR-023–FR-026, FR-028. **Prereq:** F-01 (done).

### Reguły koordynacji środowiska (obowiązywały w trakcie m2l5)

- **Port dev:** `npm run dev -- --port 4322`. (Lane A posiadał 4321.)
- **Supabase lifecycle:** ten pas **NIE** uruchamiał `supabase stop/start` — to była własność lane A.
- **Wspólna lokalna baza** (`localhost:54321/54322`) — ten pas **nie dodawał migracji**
  (używał schematu z F-01: tabele `cards`, `generations`).
- **Pliki współdzielone — ZAKAZ edycji:** `src/middleware.ts` i `src/components/Topbar.astro`
  były własnością lane A (F-02).

### Rozstrzygnięte po zamknięciu pasów

Guard `/library` był początkowo na poziomie strony **wyłącznie** dlatego, że `src/middleware.ts`
należał do lane A. Po merge'u przeniesiony do `PROTECTED_ROUTES` — zgodnie ze wzorcem repo i
z „post-merge follow-up" zapisanym w planie S-03. Link w nawigacji (Topbar) nadal odłożony.

---

## Po skończeniu

Solo Code Review (`/code-review`) → osobny PR z tego brancha.
