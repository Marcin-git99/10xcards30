<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: DB Schema Migration to PRD Model (F-01)

- **Plan**: context/changes/db-schema-mvp/plan.md
- **Scope**: Phase 1–2 of 2 (full plan), commits bc57b37 + 8b801db (range ac36729..8b801db)
- **Date**: 2026-06-11
- **Verdict**: APPROVED (2 minor warnings)
- **Findings**: 0 critical, 2 warnings, 3 observations
- **Mode**: /10x-impl-review (inline, bez sub-agentów — decyzja użytkownika); wcześniejszy ręczny review z m2l2: reviews/impl-review-manual.md

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

Notatki weryfikacyjne (2026-06-11): `npm run check` 0 errors ✅, `npm run build` ✅ (ponowione dziś); `npx supabase db reset` nie powtórzone — lokalny stack wyłączony; zaliczone przy implementacji (Progress 1.1, bc57b37) i w ręcznym review na żywej bazie. Stara migracja `20260604000000_create_cards.sql` nietknięta (pusty diff w zakresie slice'a). Wszystkie kontrakty planu (migracja, types.ts, api/cards.ts, CardsSection, CreateCardForm, package.json) — MATCH; zero plików spoza planu; granice "What We're NOT Doing" zachowane.

## Findings

### F1 — Funkcja set_updated_at() bez przypiętego search_path

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; fix oczywisty i wąski
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260609211146_reshape_schema_to_prd_model.sql:53
- **Detail**: `create or replace function set_updated_at()` nie ustawia `search_path`. Supabase security advisor flaguje to jako `function_search_path_mutable` (wektor search-path hijacking dla funkcji w public). Realne ryzyko znikome (ciało dotyka tylko NEW), ale advisor będzie zgłaszał warning.
- **Fix**: Nowa migracja z `alter function set_updated_at() set search_path = '';` (migracje immutable — nie edytować zaaplikowanego pliku).
- **Decision**: FIXED — nowa migracja `supabase/migrations/20260611183634_pin_set_updated_at_search_path.sql`; weryfikacja `db reset` przy najbliższym uruchomieniu lokalnego stacka.

### F2 — 422 z API renderuje obiekt zod jako React child (crash formularza)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; fix oczywisty i wąski
- **Dimension**: Safety & Quality (reliability) — PRE-EXISTING (potwierdzone na ac36729)
- **Location**: src/components/cards/CreateCardForm.tsx:50
- **Detail**: Przy 422 endpoint zwraca `error.flatten()` (obiekt), formularz robi `setErrors({ server: data.error })` i renderuje `{errors.server}` — React rzuca "Objects are not valid as a React child" i wysypuje wyspę. Osiągalne: klient nie waliduje max 500 znaków → wklejenie długiego tekstu → 422 → crash. Slice nie wprowadził problemu, tylko przemianował pola wokół.
- **Fix**: Traktować `data.error` jako string tylko gdy `typeof === "string"`, w przeciwnym razie fallback "Something went wrong" (1–2 linie).
- **Decision**: FIXED — guard `typeof data.error === "string"` w CreateCardForm.tsx.

### F3 — Brak indeksów pod przyszłe zapytania SRS i FK

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; fix oczywisty i wąski
- **Dimension**: Safety & Quality (performance)
- **Location**: supabase/migrations/20260609211146_reshape_schema_to_prd_model.sql:43
- **Detail**: Postgres nie indeksuje FK automatycznie: `cards.generation_id` bez indeksu (ON DELETE SET NULL → seq scan), brak `cards(user_id, next_review_at)` pod zapytania "due cards" w S-02. Przy skali MVP bez znaczenia; plan indeksów nie obiecywał. Ręczny review z m2l2 też to wyłapał.
- **Fix**: Dodać indeksy w migracji slice'a S-02 (tam, gdzie powstaje zapytanie, które ich potrzebuje).
- **Decision**: FIXED (differently — od razu zamiast czekać na S-02) — nowa migracja `supabase/migrations/20260611183943_add_cards_indexes.sql` z indeksami `cards(generation_id)` i `cards(user_id, next_review_at)`.

### F4 — Bramka lint zdescope'owana w kryteriach sukcesu

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — realny tradeoff; warto się zatrzymać
- **Dimension**: Success Criteria
- **Location**: plan.md ## Progress 2.3
- **Detail**: Kryterium "npm run lint passes" oznaczone [x] z adnotacją "descoped" — lint failuje repo-wide (CRLF + dług scaffold, nic z F-01). Descope uczciwie udokumentowany, ale dopóki cleanup nie istnieje jako osobna zmiana, kolejne slice'y dziedziczą martwą bramkę.
- **Fix A ⭐ Recommended**: Otworzyć dedykowaną zmianę cleanup (np. `/10x-new lint-debt-cleanup`) i podpiąć w roadmapie.
  - Strength: Bramka lint wraca do życia raz, zanim dług urośnie; Progress 2.3 wskazuje konkretny follow-up.
  - Tradeoff: Osobny slice poza ścieżką S-01..S-04.
  - Confidence: HIGH — przyczyny (CRLF/scaffold) znane i wąskie.
  - Blind spot: Rozmiar długu (liczba błędów lint) nie zmierzony.
- **Fix B**: Zostawić jak jest — descope udokumentowany w Progress.
  - Strength: Zero pracy teraz; zapis decyzji istnieje.
  - Tradeoff: Każdy kolejny slice dziedziczy martwą bramkę.
  - Confidence: MEDIUM — zależy ile slice'ów przed cleanupem.
  - Blind spot: j.w.
- **Decision**: FIXED via Fix A — otwarta zmiana `context/changes/lint-debt-cleanup/` (status: new) z notatką wiążącą ją z tym findingiem; plan przez `/10x-plan lint-debt-cleanup`.

### F5 — Endpoint zwraca surowe error.message z bazy przy 500

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; fix oczywisty i wąski
- **Dimension**: Safety & Quality (security) — PRE-EXISTING (potwierdzone na ac36729)
- **Location**: src/pages/api/cards.ts:55
- **Detail**: Błąd inserta zwraca `error.message` wprost do klienta — po slice'ie naruszenie nowych CHECK-ów (source/leitner_box) wypisze klientowi szczegóły schematu (nazwy constraintów/kolumn). Drobny information leak; wzorzec pre-existing.
- **Fix**: Logować error po stronie serwera, klientowi zwracać generyczne "Failed to create card".
- **Decision**: FIXED — `console.error` po stronie serwera + generyczny komunikat dla klienta w api/cards.ts.
