---
change_id: lint-debt-cleanup
title: Lint debt cleanup
status: superseded
created: 2026-06-11
updated: 2026-08-06
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

Otwarte jako fix F4 z impl-review zmiany `db-schema-mvp` ([raport](../db-schema-mvp/reviews/impl-review.md)): `npm run lint` failuje repo-wide (CRLF + dług scaffold, nic z F-01), przez co bramka lint w kryteriach sukcesu jest martwa i kolejne slice'y dziedziczą descope. Cel: doprowadzić `npm run lint` do zera błędów, żeby bramka znów działała.

## Zamknięcie (2026-08-06)

**Wchłonięte przez `context/changes/testing-data-isolation/` Phase 1.** Decyzja
zapadła w `context/foundation/test-plan.md` §5 (2026-08-02): bramka lint i
pierwsze testy musiały wylądować razem, bo osobno żadne z nich nie domykało
kryterium sukcesu.

Ta zmiana nie dostała własnego planu ani implementacji. Dług spłacony w dwóch
commitach:

- `c552e38` — `.gitattributes` z `* text=auto eol=lf` (przyczyna 1039 z 1050
  błędów) plus `.prettierignore` na `package-lock.json` i `supabase/.temp/`
- `ba1a0e6` — dziewięć realnych naruszeń reguł w trzech plikach; przy okazji
  `zod` dopisany do `dependencies`, bo rozwiązywał się wyłącznie przez
  hoisting z `astro`

Wynik: `npm run lint` → 0 błędów (zostaje jedno świadome ostrzeżenie
`no-console` w `src/pages/api/cards.ts:55` — to naprawa F5, nie dług).

Ustalenie warte zapamiętania: **1039 z 1050 błędów to były CRLF widoczne
wyłącznie na Windows.** `core.autocrlf=true` normalizuje przy commicie, więc
repozytorium od zawsze trzymało LF — na runnerze CI ten dług nigdy nie istniał
w tej skali. Diagnoza „lint failuje repo-wide" była prawdziwa lokalnie i
myląca co do rozmiaru problemu.
