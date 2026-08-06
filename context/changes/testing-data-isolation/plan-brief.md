# Runner + izolacja danych i brak wycieków — Plan Brief

> Full plan: `context/changes/testing-data-isolation/plan.md`
> Research: `context/changes/testing-data-isolation/research.md`

## What & Why

Faza 1 rolloutu testów z `test-plan.md` §3. Projekt nie ma dziś ani jednego testu,
a dwie z sześciu bramek jakości są martwe — CI nasłuchuje na gałęzi, która w tym
repozytorium nie istnieje, a `npm run lint` failuje. Ta faza stawia runner i używa
go do udowodnienia dwóch rzeczy: że dane usera A są nieosiągalne dla usera B
(Ryzyko #4), i że odpowiedzi błędu nie wypisują wnętrzności systemu (Ryzyko #2 —
jedyne ryzyko z potwierdzonym precedensem w archiwum, F5).

## Starting Point

Zero konfiguracji runnera, zero plików testowych. `astro check` jest zielony,
`npm run build` przechodzi, ale `gh run list` zwraca pustą listę — workflow nie
uruchomił się nigdy. `npm run lint` daje 1050 błędów, z czego **1039 to końce linii
CRLF**; realnych naruszeń jest dziewięć w trzech plikach. Egzekwowanie własności
zasobu leży w całości w bazie: `dashboard.astro:12` robi `select()` bez filtra po
userze, więc jedyną obroną są polityki RLS.

## Desired End State

`npm test` uruchamia suitę, która **odmawia startu**, jeśli byłaby wycelowana w
produkcyjny Supabase. Istnieje test failujący, gdy ktoś osłabi RLS na `cards` lub
`generations`. Istnieje test failujący, gdy wróci F5. Istnieje bramka failująca,
gdy sekret trafi do bundla klienta. CI uruchamia się na `main` i ma pierwszy zielony
przebieg w historii repozytorium.

## Key Decisions Made

| Decyzja                      | Wybór                                          | Dlaczego                                                                                                                                  | Źródło   |
| ---------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Warstwa dla Ryzyka #4        | Dwa klienty wprost przeciw bazie, bez Astro    | Reguła jest egzekwowana w bazie; mockowanie jej to antywzorzec z §Risk Response Guidance                                                  | Research |
| Kształt asercji izolacji     | Stan po operacji, nie kod odpowiedzi           | Odmowa RLS jest cicha: 200, `error: null`, zero wierszy — test „oczekuj błędu" przeszedłby też bez RLS                                    | Research |
| Warstwa dla błędu 500        | Hermetyczna (stub klienta)                     | Zod bez `.strict()` usuwa nieznane pola — gałąź błędu jest nieosiągalna przez HTTP                                                        | Research |
| Cel bramki „sekret w bundlu" | `dist/client/**`, nie `dist/`                  | `SUPABASE_KEY` legalnie siedzi w `dist/server/.dev.vars`, który nie jest publikowany — asercja na całym `dist/` byłaby fałszywie czerwona | Research |
| Naprawa CRLF                 | `.gitattributes` + renormalizacja              | Jedyny mechanizm nadpisujący `core.autocrlf=true`; `endOfLine: "auto"` zostawiłby mieszankę w repo                                        | Plan     |
| Guard środowiskowy           | Fail-fast całego przebiegu                     | Skip dawałby zielony przebieg z cicho pominiętymi testami izolacji — fałszywy sygnał wprost zakazany przez §1                             | Plan     |
| Podział CI / ad hoc          | Hermetyczne w CI, integracyjne ad hoc          | §4 wprost to dopuszcza; CI zostaje szybkie i bez zależności od Dockera                                                                    | Plan     |
| Dług lintowy                 | Wszystkie dziewięć błędów naprawione właściwie | Otypowanie odpowiedzi `fetch` dotyka tej samej ścieżki błędu, którą faza testuje                                                          | Plan     |
| Kolejność CI                 | Ostatnia faza, po zielonym lincie              | Pierwszy przebieg w historii repo ma być zielony, nie czerwony na 1039 błędach formatowania                                               | Plan     |

## Scope

**In scope:** runner Vitest z guardem środowiskowym · testy izolacji A/B przeciw
realnej bazie · hermetyczny test redakcji błędu 500 · bramka artefaktu builda ·
asercja strukturalna `generations` · `.gitattributes` z renormalizacją · dziewięć
błędów lint · `zod` do `package.json` · trigger CI `master`→`main` + krok testów ·
cookbook §6.2/§6.3/§6.5/§6.6 · zamknięcie `lint-debt-cleanup`

**Out of scope:** ścieżka logowania i wylogowania (Faza 2, czeka na F-02) ·
`error.message` dostawcy auth w URL-u `signin.ts`/`signup.ts` (przechodzi do
researchu Fazy 2) · `wrangler.jsonc` (decyzja użytkownika) · warstwa prezentacji ·
Stryker · e2e · testy integracyjne w CI · refaktor redakcji błędów do helpera

## Architecture / Approach

```
Faza 1  higiena repo ────────► lint zielony (warunek dla Fazy 5)
Faza 2  runner + guard ──────► miejsce, gdzie mogą stanąć testy
   │                            (zamyka niewiadomą astro:env, z fallbackiem)
   ├── Faza 3  izolacja A/B ──► realna baza, 2 tożsamości      [TDD]
   └── Faza 4  brak wycieków ─► stub + artefakt + schemat      [TDD]
                    │
Faza 5  CI ─────────┴───────► pierwszy zielony przebieg
Faza 6  cookbook ───────────► §6 przestaje być TBD
```

Testy dzielą się wg tego, czego wymagają do uruchomienia: `test:hermetic` (tylko
`dist/`, jedzie w CI) i `test:integration` (działający Supabase, bramka ad hoc).
Guard jest wspólny dla obu i ubija przebieg, gdy `SUPABASE_URL` nie wskazuje
localhosta.

## Phases at a Glance

| Faza              | Co dostarcza                                     | Kluczowe ryzyko                                                                                 |
| ----------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 1. Higiena repo   | `npm run lint` = 0 błędów, trwale                | Renormalizacja dotyka prawie każdego pliku — rebase otwartych PR-ów #1 i #2                     |
| 2. Runner + guard | Vitest stoi, testy nie mogą wejść na produkcję   | `astro:env` może nie podchwycić `.env.test` — plan niesie fallback na `test.env`                |
| 3. Izolacja A/B   | Dowód Ryzyka #4 przeciw realnej bazie            | Test, który przechodzi także bez RLS — dlatego kryterium brzmi „failuje po wyłączeniu polityki" |
| 4. Brak wycieków  | Dowód Ryzyka #2 na trzech warstwach              | Bramka artefaktu przechodzi trywialnie przy braku `dist/`                                       |
| 5. CI             | Pierwszy przebieg workflow w historii repo       | Zielony przebieg z zerem uruchomionych testów                                                   |
| 6. Cookbook       | §6 przestaje być `TBD`, rollout zsynchronizowany | Opisanie wariantu planowanego zamiast tego, który zadziałał                                     |

**Prerequisites:** Docker Desktop + `npx supabase start` (potrzebne od Fazy 2) ·
dostęp do `gh` dla weryfikacji CI · sekrety `SUPABASE_URL`/`SUPABASE_KEY` już są w
GitHub Secrets (build ich używa)

**Estimated effort:** ~3–4 sesje. Fazy 1 i 2 to jedna sesja razem; 3 i 4 po jednej;
5 i 6 domykają się szybko.

## Open Risks & Assumptions

- **`astro:env/server` w Vitest** to jedyna niewiadoma techniczna. Faza 2 kończy się
  testem, który ją rozstrzyga; przy niepowodzeniu wchodzi opisany fallback. Testy
  izolacji nie dotykają `astro:env`, więc nie są tym zablokowane.
- **`wrangler.jsonc` deklaruje `assets.directory: "./dist"`**, a adapter nadpisuje to
  na `../client`. Dziś nic nie wycieka (zweryfikowane na żywym wdrożeniu: 404), ale
  ktoś „porządkujący" konfig mógłby opublikować katalog serwerowy z sekretami.
  Świadomie poza zakresem.
- ~~**Renormalizacja skonfliktuje otwarte PR-y** #1 i #2.~~ **Nieaktualne
  (2026-08-05):** `core.autocrlf=true` normalizuje przy commicie, więc repozytorium
  od zawsze trzymało LF. Commit renormalizacyjny objął 16 plików, nie ~58 —
  konfliktów przy rebasie nie będzie.
- **Testy zostawiają konta w lokalnej bazie.** Sprzątanie wymagałoby klucza
  serwisowego, czyli wprowadzenia do suity poświadczeń omijających RLS — świadomie
  odrzucone. `db reset` czyści.
- **Zmiana `z.flatten()` → `z.treeifyError()` dotyka ciała odpowiedzi 422**, którego
  jedynym konsumentem jest komponent opisany w F2 jako podatny na crash. Guard
  `typeof === "string"` powinien wystarczyć — weryfikacja ręczna w Fazie 1.

## Success Criteria (Summary)

- Ktoś, kto usunie politykę RLS albo przywróci surowy `error.message`, dowiaduje się
  o tym z czerwonego testu — a nie z incydentu.
- Suita nie jest w stanie zapisać czegokolwiek na produkcyjnym Supabase, nawet przy
  błędnej konfiguracji.
- Bramki lint i build przestają być deklaracją w tabeli i zaczynają blokować Pull
  Requesty do `main`.
