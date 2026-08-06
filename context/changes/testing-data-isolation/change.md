---
change_id: testing-data-isolation
title: Runner + izolacja danych i brak wycieków (test-plan §3 Phase 1)
status: implementing
created: 2026-08-04
updated: 2026-08-06
archived_at: null
---

## Notes

Faza 1 rolloutu z `context/foundation/test-plan.md` §3.

**Cel (§3):** postawić runner i ożywić martwe bramki; udowodnić, że dane usera A
są nieosiągalne dla usera B, a odpowiedzi błędu nie wypisują wnętrzności systemu.

**Ryzyka do pokrycia (§2):**

- Ryzyko #2 — wewnętrzne szczegóły systemu wyciekają na zewnątrz (surowy błąd
  bazy w odpowiedzi API, sekret w bundlu, tekst źródłowy usera w miejscu
  dostępnym dla operatora). Jedyne ryzyko z potwierdzonym precedensem w
  archiwum: `context/archive/2026-06-09-db-schema-mvp/reviews/impl-review.md` §F5.
- Ryzyko #4 — dane jednego usera widoczne lub modyfikowalne przez innego usera.

**Typ testów (§3):** integration, gates.

**Dług wchłonięty przez tę fazę (decyzja z §5, 2026-08-02):**

1. Workflow CI wyzwala się na gałęzi `master`, a gałąź domyślna to `main` —
   bramki lint i build nie uruchomiły się dotąd ani razu.
2. `npm run lint` failuje w całym repozytorium.
   `context/changes/lint-debt-cleanup/` należy zamknąć jako wchłoniętą przez tę
   zmianę.

**Stan wyjściowy bazy testowej:** brak. Zero konfiguracji runnera, zero plików
testowych. `package.json` nie ma Vitest ani żadnego innego runnera — dlatego
faza setupu idzie przez `/10x-implement`, nie `/10x-tdd`.

**Środowisko:** lokalny Supabase działa (DB `127.0.0.1:54322`, API `127.0.0.1:54321`).

## Stan na 2026-08-06 — sześć faz wykonanych, cztery kryteria otwarte

Wszystkie sześć faz zaimplementowane i zacommitowane. `status` pozostaje
`implementing`, bo cztery kryteria Fazy 5 są **zablokowane po stronie GitHuba**,
nie po naszej.

| Faza | Commit |
| --- | --- |
| 1. Higiena repozytorium | `c552e38`, `ba1a0e6` |
| 2. Runner + guard | `3685ba8` |
| 3. Izolacja danych (#4) | `e804560` |
| 4. Brak wycieków (#2) | `96acf4f` |
| 5. CI | `515c76d`, `3ff34d7` |
| 6. Cookbook | `2aa83c3` |

**Otwarte: 5.2, 5.3, 5.4, 5.5.** Pierwszy przebieg w historii repozytorium
(`CI #1`, `workflow_dispatch`, commit `3ff34d7`) stał w kolejce ~13 minut i
zakończył się jako `cancelled` z **zerem wykonanych kroków** — runner nie
został przydzielony. Wcześniej push na `main` w ogóle nie wyzwolił przebiegu,
a `workflow_dispatch` przez API zwracał HTTP 500.

Zweryfikowane po naszej stronie: trigger na `main` w pliku na remote, workflow
`active`, `actions/permissions: {enabled: true, allowed_actions: all}`, sekrety
`SUPABASE_URL` i `SUPABASE_KEY` ustawione, krok testowy zasymulowany lokalnie
z identycznym środowiskiem (8 testów zielonych).

**Następny krok:** uruchomić `CI` ponownie z zakładki Actions (przycisk
`Run workflow` — wymaga zalogowania w przeglądarce). Jeśli znów utknie
w kolejce, sprawdzić rozliczenia/limity Actions dla konta `Marcin-git99`.

**Otwarte 6.3** — ocena, czy wzorce z §6 cookbooka są wykonalne bez zaglądania
do kodu testów. Naturalny moment na tę weryfikację to pisanie kolejnego testu,
czyli Faza 2 rolloutu.
