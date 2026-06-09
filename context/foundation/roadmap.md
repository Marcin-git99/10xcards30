---
project: 10xCards
version: 1
status: draft
created: 2026-06-07
updated: 2026-06-07
prd_version: 2
main_goal: speed
top_blocker: time
---

# Roadmap: 10xCards

> Derived from `context/foundation/prd.md` (v2) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

10xCards rozwiązuje problem kognitywnego kosztu tworzenia fiszek: programista wchodzący w nowy stack wie, że powinien robić fiszki, ale nie ma siły na ręczne formułowanie pytań i odpowiedzi po przeczytaniu dokumentacji. Wartość produktu leży w integracji — LLM jako generator surowych propozycji, człowiek jako kustosz jakości, algorytm Leitner-light jako scheduler — w jednym spójnym przepływie "od wklejonego tekstu do aktywnej sesji nauki w pod dwie minuty". Żaden z tych elementów nie jest nowy; nowe jest ich połączenie bez tarcia zmiany kontekstu.

## North star

**S-02: SRS review session** — pierwsza chwila, gdy user ocenia kartę [Wiem]/[Nie wiem] w sesji powtórki zainicjowanej zaraz po generacji, domykając pełną pętlę produktu.

> "North star" w tym dokumencie oznacza: najmniejszy end-to-end przepływ, którego udana dostawa udowadnia rdzenną hipotezę produktu — umieszczony tak wcześnie jak pozwalają Prerequisites, bo wszystko powyżej ma sens tylko wtedy, gdy ten przepływ działa.

## At a glance

| ID   | Change ID              | Outcome (user can …)                                                                                       | Prerequisites | PRD refs                                               | Status   |
| ---- | ---------------------- | ---------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------ | -------- |
| F-01 | db-schema-mvp          | (foundation) tabela cards zaktualizowana; tabela generations dodana; RLS kompletne                         | —             | FR-014, FR-018, FR-019, FR-028                         | ready    |
| F-02 | google-oauth-switch    | (foundation) logowanie przez Google OAuth działa; email+password usunięte                                  | —             | FR-001, FR-002, FR-003                                 | ready    |
| S-01 | first-gated-generation | wkleić tekst → wygenerować 5 kart AI → przejrzeć/edytować/odrzucić → zatwierdzić → karty zapisane w bazie | F-01, F-02    | US-01, US-04, US-05, US-09, FR-001–FR-003, FR-006–FR-014, FR-027 | proposed |
| S-02 | srs-review-session     | przejść sesję powtórki: pytanie → odpowiedź → [Wiem/Nie wiem] → podsumowanie                               | S-01          | US-06, US-08, FR-015–FR-022                            | proposed |
| S-03 | flashcard-library      | przeglądać karty, edytować Q/A, usunąć z potwierdzeniem, stworzyć pustą kartę ręcznie                      | F-01          | US-07, FR-023–FR-026, FR-028                           | proposed |
| S-04 | account-lifecycle      | wylogować się i permanentnie usunąć konto z kaskadą danych                                                 | F-01, F-02    | US-02, US-03, FR-004, FR-005                           | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme             | Chain                              | Note                                                                          |
| ------ | ----------------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| A      | Core loop         | `F-01`, `F-02` → `S-01` → `S-02`  | Ścieżka krytyczna do north star; main_goal:speed nakazuje realizować ten stream priorytetowo. |
| B      | Library & account | `S-03`, `S-04`                     | Równolegle z `S-01` po wylądowaniu F-01+F-02; żaden z tych slices'ów nie blokuje S-02. |

## Baseline

What's already in place in the codebase as of `2026-06-07` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19 + shadcn/ui + Tailwind 4; strony: `src/pages/index.astro`, `src/pages/dashboard.astro`, `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`
- **Backend / API:** partial — endpointy auth (`api/auth/signin.ts`, `api/auth/signout.ts`, `api/auth/signup.ts`) i `api/cards.ts`; auth używa **email+password** (nie Google OAuth); brak endpointów dla generacji AI i SRS
- **Data:** partial — tabela `cards` istnieje (id, user_id, front, back, created_at, updated_at); brakuje: `question`, `answer`, `source`, `generation_id`, `leitner_box`, `next_review_at`; **brak tabeli `generations`**; RLS włączone; migracja: `supabase/migrations/20260604000000_create_cards.sql`
- **Auth:** partial — Supabase auth + middleware chroni `/dashboard` (`src/middleware.ts`); provider: **email+password** — niezgodność z PRD FR-001/FR-002 (wymaga Google OAuth)
- **Deploy / infra:** present — `wrangler.jsonc` + Cloudflare Workers + GitHub Actions CI (`.github/workflows/ci.yml`)
- **Observability:** absent — brak Sentry, structured logging, metryk

## Foundations

### F-01: DB schema migration to PRD model

- **Outcome:** (foundation) tabela `cards` zaktualizowana (pola: `question`, `answer`, `source enum('ai','manual')`, `generation_id uuid nullable FK→generations`, `leitner_box int 1-5`, `next_review_at timestamptz`; stare pola `front`/`back` usunięte), tabela `generations` dodana (id, user_id FK→users cascade, source_text_hash, source_text_length, created_at), RLS policies kompletne dla obu tabel (per-operation, per-role, bez `FOR ALL`).
- **Change ID:** db-schema-mvp
- **PRD refs:** FR-014 (wymaga generation_id + source='ai' przy zapisie karty z paczki), FR-018, FR-019 (wymagają leitner_box + next_review_at), FR-028 (wymaga source='manual')
- **Unlocks:** S-01 (pełny schemat DB potrzebny do zapisu kart z generacji), S-02 (leitner_box + next_review_at), S-03 (source + generation_id dla "Moje fiszki"), S-04 (tabela generations musi istnieć dla kaskadowego delete User→Generations→Cards)
- **Prerequisites:** —
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Zmiana nazw pól (`front`→`question`, `back`→`answer`) zepsuje istniejące zapytania w `api/cards.ts` — bezpieczne w MVP (brak produkcyjnych userów z danymi do zachowania), ale wymaga synchronizacji migracji z deploymentem zaktualizowanego kodu API; cały downstream zależy od poprawności tego schematu.
- **Status:** ready

### F-02: Google OAuth switch

- **Outcome:** (foundation) logowanie przez Google OAuth działa (Supabase `signInWithOAuth({ provider: 'google' })`); `api/auth/signin.ts` zaktualizowany; strony auth dostosowane do PKCE redirect flow; callback URL skonfigurowany w Supabase dashboard i Google Cloud Console OAuth credentials; email+password usunięte z flow.
- **Change ID:** google-oauth-switch
- **PRD refs:** FR-001 (przycisk "Zaloguj przez Google" na landing page), FR-002 (auto-create/reconnect konta po Google OAuth na podstawie stable external identifier), FR-003 (sesja persystowana przez Supabase SSR cookies do wylogowania)
- **Unlocks:** S-01 (gated generation wymaga poprawnego Google OAuth per FR-001/FR-002), S-04 (wylogowanie i delete konta muszą czyścić sesję OAuth)
- **Prerequisites:** —
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Zmiana auth providera zresetuje istniejące sesje i konta testowe (email+password) — akceptowalne w MVP przed pierwszymi realnymi userami; callback URL musi być ręcznie dodany do Google Cloud Console OAuth credentials zanim flow zadziała w produkcji.
- **Status:** ready

## Slices

### S-01: First gated generation loop

- **Outcome:** user może wkleić tekst źródłowy (min. 500 znaków), wygenerować paczkę 5 kart AI, przejrzeć każdą kartę (edytować Q/A, usunąć z paczki), zatwierdzić przez [Zatwierdź i przejdź do nauki] — zaakceptowane karty lądują w bazie z `source='ai'`, `generation_id` powiązanym z rekordem Generation, `leitner_box=1`, `next_review_at=now`; user jest przekierowany do sesji SRS (S-02).
- **Change ID:** first-gated-generation
- **PRD refs:** US-01, US-04, US-05, US-09, FR-001, FR-002, FR-003, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-027
- **Prerequisites:** F-01 (pełny schemat DB), F-02 (Google OAuth)
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:**
  - Który dostawca LLM (OpenAI gpt-4o-mini vs Anthropic Claude Haiku) i czy jego warunki użytkowania pokrywają NFR o nieprzechowywaniu tekstu przez operatora? — Owner: ty. Block: no.
  - Jak obsłużyć retry storm: jeśli LLM 3 razy z rzędu nie zwróci dokładnie 5 kart dla tego samego inputu — nieskończone retry czy komunikat "spróbuj z innym fragmentem"? — Owner: ty. Block: no.
- **Risk:** Prerequisite dla north star (S-02) — S-02 nie ma kart do wyświetlenia bez S-01; FR-014 wymaga redirect do SRS session, który implementuje S-02, więc S-01 dostarcza persist + trigger, a S-02 dostarcza docelowy widok; błąd w logice save (np. brakujący generation_id) jest cicho niszczący — warto pokryć unit-testem.
- **Status:** proposed

### S-02: SRS review session

- **Outcome:** user może przejść sesję powtórki — widzi pytanie jednej karty, odsłania odpowiedź kliknięciem, ocenia [Wiem]/[Nie wiem] (system przesuwa kartę w drabinie Leitner-light per FR-021: box1=1d, box2=3d, box3=7d, box4=14d, box5=30d), kolejne karty pojawiają się bez dodatkowego klikania, po ostatniej karcie widzi ekran podsumowania z liczbą przerobionych kart, % [Wiem] i copy "Następna powtórka jutro o ~10:00".
- **Change ID:** srs-review-session
- **PRD refs:** US-06, US-08, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022
- **Prerequisites:** S-01 (karty muszą istnieć w bazie z `leitner_box=1` i `next_review_at=now`, co zapewnia S-01 po [Zatwierdź])
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:**
  - Co widzi user gdy otwiera sesję SRS i ma zero due-cards: komunikat z następnym czasem, redirect na ekran główny czy zaproszenie do generacji? — Owner: ty. Block: no.
- **Risk:** Logika stanu Leitner (`leitner_box` + `next_review_at` per interwał z FR-021) nie crashuje aplikacji gdy jest błędna — cicho niszczy wartość produktu (karta wraca za wcześnie lub za późno); warto przetestować manualnie każdą ścieżkę [Wiem]/[Nie wiem] oraz edge case cap box=5.
- **Status:** proposed

### S-03: Flashcard library ("Moje fiszki")

- **Outcome:** user może otworzyć "Moje fiszki" i zobaczyć wszystkie swoje karty (AI + manualne) posortowane `created_at` desc, edytować Q i/lub A dowolnej karty bez zmiany `leitner_box`/`next_review_at`, usunąć kartę z potwierdzeniem, oraz stworzyć pustą kartę ręcznie przez [+ Nowa fiszka] (karta pojawia się w liście jako edytowalna, wykluczona z kolejki SRS dopóki oba pola Q i A nie zostaną wypełnione).
- **Change ID:** flashcard-library
- **PRD refs:** US-07, FR-023, FR-024, FR-025, FR-026, FR-028
- **Prerequisites:** F-01 (pola `source` i `generation_id` w schemacie cards)
- **Parallel with:** S-01, S-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Edycja karty NIE może resetować `leitner_box`/`next_review_at` (BR-3/FR-026) — prosta reguła ale łatwa do pominięcia; warto sprawdzić manualnie że ocena karty i pozycja w drabinie Leitner nie zmieniają się po edycji Q lub A.
- **Status:** proposed

### S-04: Account lifecycle

- **Outcome:** user może wylogować się (sesja wyczyszczona, redirect na landing page) i permanentnie usunąć konto przez [Usuń konto] + potwierdzenie w dialogu — system kaskadowo i nieodwracalnie usuwa profil, wszystkie rekordy Generation i Card usera, kończy sesję i przekierowuje na landing page.
- **Change ID:** account-lifecycle
- **PRD refs:** US-02, US-03, FR-004, FR-005
- **Prerequisites:** F-01 (tabela `generations` musi istnieć dla kaskadowego delete), F-02 (wylogowanie musi czyścić sesję Google OAuth)
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Kaskadowe delete musi obejmować tabelę `generations` z F-01; pominięcie generacji w kaskadzie zostawi osierocone rekordy i naruszy Guardrail PRD ("Żadne dane jednego usera nie są widoczne ani działalne przez innego usera" oraz prywatność source text); warto zweryfikować że po delete konto reaktywowane przez OAuth jest traktowane jak nowe.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID              | Suggested issue title                               | Ready for `/10x-plan` | Notes                          |
| ---------- | ---------------------- | --------------------------------------------------- | --------------------- | ------------------------------ |
| F-01       | db-schema-mvp          | DB: migrate cards schema + add generations table    | yes                   | Run `/10x-plan db-schema-mvp`  |
| F-02       | google-oauth-switch    | Auth: switch from email+password to Google OAuth    | yes                   | Run `/10x-plan google-oauth-switch` |
| S-01       | first-gated-generation | Feature: AI generation loop (paste → review → save) | no                    | Czeka na F-01 + F-02           |
| S-02       | srs-review-session     | Feature: SRS review session (Leitner-light)         | no                    | Czeka na S-01                  |
| S-03       | flashcard-library      | Feature: "Moje fiszki" library screen               | no                    | Czeka na F-01                  |
| S-04       | account-lifecycle      | Feature: sign-out + permanent account deletion      | no                    | Czeka na F-01 + F-02           |

## Open Roadmap Questions

1. **Guardrails completeness** — Czy cztery Guardrails z PRD (§ Success Criteria) są wyczerpujące, czy należy dodać floor dostępności lub minimum accessibility? — Owner: ty. Block: roadmap-wide (nie blokuje żadnego slice'a technicznie, ale może rozszerzyć scope).
2. **Target scale beyond dogfooding** — `target_scale.users: small` na etapie dogfooding; jaki jest cel skali po 3/6/12 miesiącach? Odpowiedź może wymuszać decyzję o observability i limitach tabel. — Owner: ty. Block: no.
3. **Latency observability** — NFR zakłada p95 < 10s, ale brak mechanizmu monitorowania w produkcji; czy MVP potrzebuje choćby error-log dla timeoutów (Sentry-style), czy wystarczy timeout-handling w kodzie FR-027? — Owner: ty. Block: no.

## Parked

- **Observability dashboard / monitoring platform** — Dlaczego parkowane: main_goal:speed + top_blocker:time; absent w baseline; PRD nie wymaga dashboardu (NFR mówi o latency, not o dashboardzie operatora).
- **CI/CD automation (CD)** — Dlaczego parkowane: PRD § Non-Goals "No automated CI/CD pipelines in MVP"; CI istnieje (ci.yml), CD pozostaje ręczne per PRD Cut-4.
- **Second OAuth provider (GitHub)** — Dlaczego parkowane: PRD § Non-Goals "No alternative authentication paths"; kandydat do v2 dla persony developer.
- **Email + password auth** — Dlaczego parkowane: PRD § Non-Goals; v2 jeśli pojawi się persona poza-dev.
- **Deck/folder/topic organization** — Dlaczego parkowane: PRD § Non-Goals "No decks, sets, topics, or folders"; flat pool w MVP.
- **Richer SRS algorithms (SM-2, FSRS)** — Dlaczego parkowane: PRD § Non-Goals "No richer rating granularity"; Leitner-light binary wystarczy na MVP.
- **Mobile native apps** — Dlaczego parkowane: PRD § Non-Goals; web-only w MVP.
- **Deck sharing / multi-user** — Dlaczego parkowane: PRD § Non-Goals.
- **PDF/DOCX import** — Dlaczego parkowane: PRD § Non-Goals; copy-paste only.
- **Settings screen / configurable session schedule** — Dlaczego parkowane: PRD § Non-Goals "No user-facing settings screen".
- **GDPR data export (Article 20)** — Dlaczego parkowane: PRD § Non-Goals; right-to-be-forgotten (delete account) pokrywa MVP.
- **Session analytics / trend charts** — Dlaczego parkowane: PRD § Non-Goals; session summary jednoekranowe w MVP (US-08), bez historii cross-session.
- **Latency monitoring platform** — Dlaczego parkowane: top_blocker:time; timeout-handling w kodzie (FR-027) wystarczy na MVP.

## Done

(Wypełnia `/10x-archive` gdy change odpowiadający roadmap ID zostanie zarchiwizowany.)
