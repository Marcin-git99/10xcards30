# Plan — api-error-correlation

> **Zapis po fakcie.** Ten plik dokumentuje pracę, która została wykonana i
> zweryfikowana _przed_ założeniem folderu zmiany (patrz `change.md` §Notes).
> Nie kierował implementacją. Zachowuje jednak format `## Progress`, żeby
> zmiana czytała się w archiwum tak samo jak pozostałe.

## Problem

Gdy zapis fiszki pada, [`POST /api/cards`](../../../src/pages/api/cards.ts)
zwracał `500 {"error":"Failed to create card"}`, a pełny błąd bazy szedł do
`console.error`. Redakcja była poprawna — Ryzyko #2 z
[test-plan.md](../../foundation/test-plan.md) §2 zabrania wypuszczania nazw
tabel, kolumn i kodów błędów — ale **nie istniało nic, co łączyłoby zgłoszenie
usera z wpisem w logu**. User widział zdanie bez treści, operator widział log
bez adresata.

To druga połowa naprawy §F5 z
[`context/archive/2026-06-09-db-schema-mvp/reviews/impl-review.md`](../../archive/2026-06-09-db-schema-mvp/reviews/impl-review.md).
Pierwsza połowa (redakcja) wylądowała wtedy; korelacja nie.

## Kontrakt do obrony

Wyrocznia nie pochodzi z implementacji, tylko z dwóch źródeł, które istniały
wcześniej:

1. [`test/hermetic/cards-error-redaction.test.ts`](../../../test/hermetic/cards-error-redaction.test.ts)
   — negatywna lista wycieków `["cards", "constraint", "violates", "23514",
"relation", "check"]` sprawdzana case-insensitive na całym ciele odpowiedzi,
   plus wymóg, żeby `error` był stringiem (precedens §F2: obiekt renderowany
   jako React child wysypuje wyspę).
2. [test-plan.md §6.3](../../foundation/test-plan.md) — „Redakcja ma dwie
   połowy. Szczegóły mają zniknąć z odpowiedzi, ale trafić do logu serwera."

Wniosek projektowy: identyfikator musi być **losowy i bezznaczeniowy**. Kod
błędu bazy albo nazwa constraintu byłyby wygodniejsze, ale to dokładnie te
wnętrzności, których lista zakazanych ciągów broni.

## Rozwiązanie

`logServerError(context, detail)` w [`src/lib/api-error.ts`](../../../src/lib/api-error.ts)
generuje `crypto.randomUUID()`, loguje `[ref] context` razem z pełnym błędem
i zwraca ref. Endpoint wstawia ten sam ref do komunikatu dla klienta.

Helper stoi w `src/lib/` zgodnie z konwencją z `CLAUDE.md` (§Key conventions),
mimo jednego dziś konsumenta — koduje **politykę**, która ma obowiązywać także
w `signin`/`signup`/`signout`. Rozszerzenie na nie jest świadomie poza zakresem.

## Ryzyko przyjęte świadomie

Test wycieku sprawdza brak podciągu `"23514"`. UUID jest szesnastkowy, więc
teoretycznie może go wylosować: 12 pozycji × (1/16)⁵ ≈ **1 na ~87 000
przebiegów**. Nie warte obchodzenia; udokumentowane, żeby przyszła
niewytłumaczalna czerwona nie kosztowała godziny.

## Uwaga o SHA w `## Progress`

SHA nosi tylko to, co zostawiło diff (kroki 1.1, 1.2, 2.1 → `946f825`).
Kroki 2.2 i 3.1–3.4 to akty weryfikacji — uruchomienie mutacji i bramek — po
których nie ma artefaktu w historii. Zostają bez SHA zgodnie z
`references/progress-format.md` („SHA-less rows are legitimate for empty-diff
phases"). `/10x-archive` zgłosi je jako miękkie ostrzeżenie; to sygnał, nie defekt.

## References

- `context/foundation/test-plan.md` §2 (Ryzyko #2), §6.3 (wzorzec testu ścieżki błędu)
- `context/archive/2026-06-09-db-schema-mvp/reviews/impl-review.md` §F5, §F2
- `src/components/cards/CreateCardForm.tsx:62` — konsument renderuje wyłącznie `data.error` jako string

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Polityka błędu serwerowego

#### Automated

- [x] 1.1 Helper `logServerError` w `src/lib/api-error.ts` — 946f825
- [x] 1.2 Gałąź błędu w `POST /api/cards` używa refa zwróconego przez helper — 946f825

### Phase 2: Regresja korelacji

#### Automated

- [x] 2.1 Test „łączy odpowiedź z logiem tym samym identyfikatorem" — 946f825
- [x] 2.2 Weryfikacja mutacją — rozspójnienie refa zabija dokładnie ten jeden test

### Phase 3: Bramki

#### Automated

- [x] 3.1 Suita hermetyczna — 9/9
- [x] 3.2 `astro check` — 0 błędów na 42 plikach
- [x] 3.3 eslint na zmienionych plikach — 0 błędów
- [x] 3.4 Suita integracyjna — 11/11

#### Manual

- [x] 3.5 Smoke na wdrożonym środowisku — 2026-08-07, blokada zdjęta

  Blokada miała dwie warstwy, nie jedną. Zaległe migracje były tylko pierwszą:
  `npx supabase db push` dociągnął trzy brakujące (`20260609211146`,
  `20260611183634`, `20260611183943`) i to niczego nie naprawiło — komunikat
  zmienił się z „nie znam kolumny `question`" na „nie znam kolumny `back`".
  Druga warstwa: wdrożony Worker pochodził z 2026-06-05, czyli sprzed `813c8d8`,
  więc wysyłał `front`/`back`. Redeploy `main` (Version ID
  `62a10af0-4715-4486-aef8-5edfff6a7f6d`) domknął sprawę.

  Zweryfikowane na `10xcards30.turolmar1-775.workers.dev`: logowanie, zapis
  fiszki, fiszka widoczna na liście. Sondy REST przed i po migracji potwierdziły
  zmianę schematu od strony API (`generations` 404 → 200, `cards.front` 200 → 400).

  **Czego to NIE weryfikuje:** korelacja z `946f825` nie jest jeszcze na
  produkcji — wdrożony `main` ma redakcję błędu, ale nie identyfikator
  odsyłający do logu. Ścieżka korelacji trafi na produkcję po scaleniu tego PR-a
  i kolejnym deployu; wywołanie jej wymaga sprowokowania błędu serwera, więc nie
  domknie się przy okazji zwykłego smoke'u.
