---
change_id: testing-data-isolation
title: Runner + izolacja danych i brak wycieków (test-plan §3 Phase 1)
status: implementing
created: 2026-08-04
updated: 2026-08-05
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
