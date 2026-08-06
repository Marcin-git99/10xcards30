# Runner + izolacja danych i brak wycieków — Implementation Plan

## Overview

Faza 1 rolloutu z `context/foundation/test-plan.md` §3. Stawia od zera bazę testową
tego projektu i używa jej do udowodnienia dwóch ryzyk: że dane usera A są
nieosiągalne dla usera B (Ryzyko #4) i że odpowiedzi błędu nie wypisują wnętrzności
systemu (Ryzyko #2). Po drodze wchłania dług, bez którego żadna bramka nic nie
znaczy — martwy trigger CI i `npm run lint` failujący repo-wide.

Plan jest zbudowany wokół jednej zasady kolejności: **CI ożywiamy na końcu**.
Pierwszy przebieg workflow w historii tego repozytorium ma być zielony. Naprawa
triggera przed doprowadzeniem lintu do zera dałaby czerwony przebieg i zaszumiła
sygnał w momencie, w którym bramka po raz pierwszy zaczyna cokolwiek znaczyć.

## Current State Analysis

Ugruntowane empirycznie w `research.md` (2026-08-04), nie z lektury kodu.

**Czego nie ma.** Zero konfiguracji runnera, zero plików testowych. `package.json`
nie zawiera Vitest ani żadnego innego runnera.

**Bramki.** `astro check` → 0 errors (zielona, już dziś coś znaczy).
`npm run build` → przechodzi. `npm run lint` → 1050 błędów, z czego **1039 to
`prettier/prettier` „Delete `␍`"**; realnych naruszeń reguł jest dziewięć, w trzech
plikach. `gh run list` zwraca pustą listę — workflow nasłuchuje na `master`, gałąź
domyślna to `main`, więc CI nie uruchomiło się dotąd ani razu.

**Gdzie mieszka Ryzyko #4.** W całości w bazie. `src/pages/dashboard.astro:12`
robi `select()` bez filtra po userze — jedyną obroną są polityki RLS. Endpointów
`GET`/`PUT`/`DELETE` dla kart nie ma, więc powierzchni IDOR na warstwie HTTP dziś
nie ma. `src/pages/api/cards.ts:50` bierze `user_id` z sesji, nigdy z ciała żądania.

**Jak wygląda odmowa RLS.** Zmierzone: select / update / delete usera B na zasobie
usera A → **HTTP 200, `error: null`, zero wierszy**. Nie 403, nie wyjątek. Jedyny
twardy błąd daje INSERT z cudzym `user_id` → 403 / `42501`.

**Gdzie mieszka Ryzyko #2.** Trzy rozłączne twarze:
błąd 500 w `cards.ts` (zredagowany od czasu F5, ale jego gałąź jest **nieosiągalna
przez realną infrastrukturę** — zod bez `.strict()` usuwa nieznane pola, więc klient
nie ma jak wywołać naruszenia CHECK-a); sekret w artefakcie builda (`SUPABASE_KEY`
**jest** w `dist/server/.dev.vars`, ale nie w `dist/client/**`, i nie jest
publikowany); tekst źródłowy w `generations` (schema go nie mieści, ale funkcja
generacji nie istnieje).

**Blokada wykonawcza.** `.env` i `.dev.vars` wskazują **produkcyjny** projekt
Supabase. Każdy test importujący `@/lib/supabase` bez nadpisania środowiska zakłada
konta na produkcji.

**Przyczyna CRLF.** `core.autocrlf = true`, brak `.gitattributes`, `.prettierrc.json`
bez `endOfLine` (domyślnie `"lf"`).

**Niezadeklarowana zależność.** `src/pages/api/cards.ts:2` importuje `zod`, którego
nie ma w `package.json` — rozwiązuje się przez hoisting z `astro@6.3.1`.

## Desired End State

Po wykonaniu planu:

- `npm run lint` zwraca zero błędów — lokalnie na Windows i na Linuksie — i zostaje
  taki po `git checkout` na dowolnym systemie.
- `npm test` uruchamia suitę, która **odmawia startu**, jeśli rozwiązany
  `SUPABASE_URL` nie wskazuje localhosta.
- Istnieje test, który failuje, gdy ktoś usunie albo osłabi polityki RLS na `cards`
  lub `generations`.
- Istnieje test, który failuje, gdy odpowiedź błędu endpointu kart zacznie
  przepuszczać treść błędu bazy — czyli gdy F5 wróci.
- Istnieje bramka, która failuje, gdy `SUPABASE_KEY` trafi do `dist/client/**`.
- CI uruchamia się na `main`, przechodzi lint, build i testy niewymagające bazy.
- `test-plan.md` §6.2, §6.3, §6.5 nie są już `TBD`, a §3 Faza 1 ma status `complete`.

**Weryfikacja końcowa:** `npm run lint && npm run check && npm run build && npm test`
przechodzi lokalnie przy uruchomionym Supabase, a workflow CI ma pierwszy zielony
przebieg na `main`.

### Key Discoveries:

- Odmowa RLS jest cicha (`research.md` §A) — test asertujący błąd przeszedłby też
  na bazie bez RLS. Wyrocznia: zero wierszy **oraz** wiersz usera A niezmieniony.
- Gałąź `if (error)` w `src/pages/api/cards.ts:54` jest nieosiągalna przez HTTP
  (zod usuwa nieznane pola) → warstwa hermetyczna, nie integracyjna.
- Efektywny `assets.directory` to `dist/client`, nie `./dist` z `wrangler.jsonc:11`
  — adapter nadpisuje. Asercja na całym `dist/` byłaby fałszywie czerwona.
- `[auth.email] enable_confirmations = false` w `supabase/config.toml:209` — zwykłe
  `signUp()` zwraca od razu sesję. Fixture dwóch tożsamości nie potrzebuje klucza
  serwisowego ani Admin API.
- `supabase status -o env` udostępnia maszynowo `API_URL`, `ANON_KEY`, `DB_URL` —
  konfigurację testową da się wygenerować bez ręcznego kopiowania kluczy.
- `no-console` w `cards.ts:55` to **ostrzeżenie**, nie błąd — naprawa F5 nie łamie
  bramki lint. Nie „sprzątać" tego `console.error`.

## What We're NOT Doing

- **Nie testujemy ścieżki logowania ani wylogowania.** Należy do §3 Fazy 2, która
  czeka na wylądowanie F-02.
- **Nie ruszamy `signin.ts:16` / `signup.ts:16`**, mimo że wstawiają `error.message`
  dostawcy auth do parametru URL — to realna twarz Ryzyka #2, ale
  `google-oauth-switch` przepisuje dokładnie tę ścieżkę. Ustalenie przechodzi do
  researchu Fazy 2.
- **Nie ruszamy `wrangler.jsonc`** (decyzja użytkownika 2026-08-05). Rozbieżność
  `./dist` vs efektywne `../client` zostaje w Open Risks.
- **Nie testujemy warstwy prezentacji** — komponentów `.astro` ani React. `§4`
  wyklucza to z rolloutu.
- **Nie konfigurujemy Strykera.** Mutation testing jest bramką selektywną po fazie,
  nie elementem jej dostawy.
- **Nie uruchamiamy testów integracyjnych w CI** (decyzja 2026-08-05) — zostają
  bramką ad hoc zgodnie z §4.
- **Nie dodajemy e2e.** §4 pozostawia decyzję Fazie 2; Ryzyka #2 i #4 składają się
  niżej.
- **Nie refaktoryzujemy redakcji błędów do helpera.** Przy jednym endpoint'cie to
  przedwczesne; wzorzec trafia do cookbooka §6.5, wydzielenie przy trzecim.

## Implementation Approach

Sześć faz w kolejności wymuszonej zależnościami, nie wygodą.

Higiena repozytorium idzie pierwsza, bo renormalizacja końców linii dotyka prawie
każdego pliku — wykonana później zmieszałaby się z diffem testów i uczyniła review
niemożliwym. Runner i guard idą drugie, bo bez nich nie ma gdzie postawić żadnego
testu, a bez guardu pierwszy test może zapisać dane na produkcji. Testy idą trzecie
i czwarte, rozdzielone wg ryzyka i warstwy. CI idzie piąte, gdy jest już co
uruchamiać i gdy przebieg będzie zielony. Cookbook zamyka.

Warstwy testów przypisane wg zasady koszt × sygnał z §1:

| Co dowodzimy                | Warstwa                                            | Dlaczego nie taniej / nie drożej                                                                                                              |
| --------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Izolacja A/B (#4)           | Dwa klienty Supabase wprost przeciw lokalnej bazie | Reguła jest egzekwowana w bazie; mockowanie tej warstwy to antywzorzec z §Risk Response Guidance. Bootowanie Astro dokłada koszt bez sygnału. |
| Redakcja błędu 500 (#2)     | Hermetyczna — stub klienta                         | Ścieżka nieosiągalna przez realną infrastrukturę. Test integracyjny musiałby wymuszać stan, którego produkcja nie osiąga.                     |
| Sekret w bundlu (#2)        | Asercja na artefakcie po `npm run build`           | Deterministyczna i tania. Nie ma tu czego uruchamiać.                                                                                         |
| Brak tekstu źródłowego (#2) | Asercja strukturalna na kolumnach                  | Zachowania nie ma czego testować, dopóki nie ma generacji.                                                                                    |

## Critical Implementation Details

**Kolejność CI vs lint.** Trigger CI wolno naprawić dopiero po Fazie 1. Naprawiony
wcześniej spowoduje, że pierwszy przebieg workflow w historii repozytorium będzie
czerwony na 1039 błędach formatowania — i utrwali przekonanie, że bramka jest
kłopotem, a nie sygnałem.

**Renormalizacja a otwarte PR-y.** ~~`.gitattributes` z jednorazową renormalizacją
dotknie prawie każdego pliku. Otwarte Pull Requesty #1 i #2 (F-02, S-03) będą
wymagały rebase'u i pokażą konflikty na końcach linii.~~

**Skorygowane po wykonaniu Fazy 1 (2026-08-05):** to ostrzeżenie było nadmiarowe.
`core.autocrlf=true` konwertuje CRLF→LF **przy commicie**, więc w repozytorium
pliki od zawsze były LF-owe — CRLF istniał wyłącznie w drzewie roboczym. Commit
renormalizacyjny objął **16 plików** (realne zmiany formatowania), nie ~58.
Konfliktów na końcach linii przy rebasie otwartych PR-ów **nie będzie**.
Renormalizacja została mimo to wykonana jako osobny commit (`c552e38`), co
zachowuje czytelność historii.

**Bramka artefaktu musi failować przy braku `dist/`.** Test czytający `dist/client/**`
przechodzi trywialnie, gdy katalog nie istnieje — nie ma czego znaleźć. To
najgorszy możliwy tryb awarii bramki bezpieczeństwa: zielona, bo nic nie
sprawdziła. Test musi jawnie asertować istnienie artefaktu, zanim zacznie w nim
szukać.

## Phase 1: Higiena repozytorium — końce linii i dług lintowy

### Overview

Doprowadzić `npm run lint` do zera błędów w sposób, który przeżyje `git checkout`
na innym systemie. Świadomie nie dotyka `.github/workflows/ci.yml`.

### Changes Required:

#### 1. Normalizacja końców linii

**File**: `.gitattributes` (nowy)

**Intent**: Wymusić LF w drzewie roboczym niezależnie od `core.autocrlf`, żeby
prettier widział to samo na Windows i na runnerze CI. Bez tego każda naprawa
formatowania jest cofana przez następny checkout.

**Contract**: Reguła `text=auto eol=lf` dla plików tekstowych; pliki binarne
(`*.png`) oznaczone `binary`. `eol=lf` nadpisuje `core.autocrlf=true` — to jedyny
mechanizm w gicie, który to robi.

#### 2. Renormalizacja istniejących plików

**File**: całe repozytorium (osobny commit)

**Intent**: Przepisać pliki już zapisane w indeksie z CRLF na LF, żeby nowa reguła
zaczęła obowiązywać wstecz. Sam `.gitattributes` działa tylko na przyszłe zapisy.

**Contract**: `git add --renormalize .` + `npm run format`. Wynikowy commit dotyka
prawie każdego pliku i **nie zawiera żadnej zmiany semantycznej** — to warunek,
który recenzent musi móc zweryfikować jednym spojrzeniem na `git diff --stat`.

#### 3. Dziewięć realnych naruszeń reguł

**File**: `src/components/cards/CreateCardForm.tsx`

**Intent**: Otypować odpowiedź `fetch`, żeby zniknęły `no-unsafe-assignment` (×3)
i `no-unsafe-member-access` (×2), plus zamienić przestarzały `React.FormEvent` i
poprawić `no-confusing-void-expression` w `setTimeout`. Otypowanie dotyka dokładnie
tej ścieżki błędu, którą Faza 4 testuje — guard `typeof data.error === "string"`
z F2 musi przeżyć zmianę.

**Contract**: Kształt odpowiedzi błędu jako jawny typ (pole `error` może być
stringiem albo obiektem — obie możliwości wynikają z `cards.ts:34` i `:56`).
Zachowanie widoczne dla użytkownika bez zmian: przy nie-stringu nadal
`"Something went wrong"`.

**File**: `src/pages/api/cards.ts`

**Intent**: Zamienić przestarzałe `result.error.flatten()` na `z.treeifyError()`.

**Contract**: **Zmienia kształt ciała odpowiedzi 422.** Klient (`CreateCardForm.tsx:50`)
nie polega na strukturze — sprawdza tylko `typeof === "string"` — więc pozostaje
zgodny, ale ta zależność musi zostać zweryfikowana ręcznie, bo to dokładnie ten
crash, który opisuje F2 w archiwum.

**File**: `src/pages/dashboard.astro`

**Intent**: Usunąć zbędne `??` w linii 13 (`no-unnecessary-condition`).

**Contract**: Bez zmiany zachowania — `data` z Supabase jest tu już zawężone.

#### 4. Deklaracja zależności

**File**: `package.json`

**Intent**: Dodać `zod` do `dependencies`. Dziś rozwiązuje się wyłącznie przez
hoisting z `astro`; bump majora w Astro wywróci build bez żadnej zmiany w kodzie
aplikacji.

**Contract**: Zakres zgodny z tym, co rozwiązuje się dziś (`4.4.3`), zapisany jako
`^4.4.3`. `npm ls zod` po zmianie ma pokazywać jedno drzewo bez konfliktu.

### Success Criteria:

#### Automated Verification:

- `npm run lint` zwraca zero błędów
- `npm run check` nadal zwraca zero błędów
- `npm run build` nadal przechodzi
- `npm ls zod` nie zgłasza konfliktu wersji
- Commit renormalizacyjny nie zawiera zmian semantycznych: `git show --stat` pokazuje wyłącznie zmiany końców linii

#### Manual Verification:

- Formularz dodawania karty nadal działa: poprawna karta zapisuje się, a błąd walidacji (np. pusty tekst) pokazuje komunikat zamiast wysypywać wyspę React — regresja F2
- Dashboard nadal wyświetla listę kart zalogowanego usera

**Implementation Note**: Po tej fazie zatrzymaj się na ręczne potwierdzenie —
zmiana `flatten` → `treeifyError` dotyka ciała odpowiedzi 422, a jedyny konsument
tej odpowiedzi to komponent, który już raz się na tym wysypał.

---

## Phase 2: Runner + guard środowiskowy

### Overview

Postawić Vitest i zamknąć jedyną niewiadomą techniczną planu: czy `astro:env/server`
w Vitest rozwiąże testowy plik środowiska. Faza kończy się testem, który **nie
przechodzi**, jeśli suita byłaby wycelowana w produkcję.

### Changes Required:

#### 1. Runner

**File**: `package.json`, `vitest.config.ts` (nowy)

**Intent**: Zainstalować Vitest i skonfigurować go przez `getViteConfig()` z
`astro/config`, żeby testy widziały aliasy `@/*` i wirtualne moduły Astro.

**Contract**: `test.environment: 'node'` — Astro 6 nie pozwala renderować
komponentów `.astro` w klienckich środowiskach Vitest. `test.setupFiles` wskazuje
plik guardu z punktu 3. Wersja Vitest musi być zgodna z `overrides.vite: ^7.3.2`
z `package.json`.

Skrypty npm rozdzielają suity wg tego, czego wymagają do uruchomienia:

| Skrypt             | Zawiera                        | Wymaga              |
| ------------------ | ------------------------------ | ------------------- |
| `test`             | wszystko                       | działający Supabase |
| `test:hermetic`    | hermetyczne + bramki artefaktu | tylko `dist/`       |
| `test:integration` | testy przeciw bazie            | działający Supabase |

#### 2. Środowisko testowe

**File**: `.env.test` (nowy, gitignored), `.env.example`

**Intent**: Odciąć testy od produkcyjnego projektu Supabase, na który wskazują dziś
`.env` i `.dev.vars`.

**Contract**: `SUPABASE_URL` i `SUPABASE_KEY` wskazujące lokalny stack — wartości
pochodzą z `supabase status -o env` (`API_URL`, `ANON_KEY`), nie z ręcznego
kopiowania. `.env.test` dopisany do `.gitignore`; `.env.example` dostaje komentarz
mówiący, skąd wziąć wartości testowe.

#### 3. Guard fail-fast

**File**: `test/setup.ts` (nowy)

**Intent**: Uczynić błąd konfiguracji środowiska głośnym w pierwszej sekundzie
przebiegu, zamiast odkrywać go po założeniu kont `probe_…@example.com` na
produkcji. Decyzja z 2026-08-05: guard ubija **cały** przebieg, również testy
hermetyczne.

**Contract**: Setup odczytuje rozwiązany `SUPABASE_URL` i rzuca, jeśli host nie jest
`127.0.0.1` ani `localhost`. Komunikat musi nazywać rozwiązaną wartość i wskazać
`.env.test` jako miejsce naprawy — guard, którego komunikat nie mówi co zrobić,
zostanie obszedł.

#### 4. Zamknięcie niewiadomej `astro:env`

**File**: `test/env-sanity.test.ts` (nowy)

**Intent**: Zweryfikować, że mechanizm z punktu 2 faktycznie działa — że
`astro:env/server` w Vitest widzi `.env.test`, a nie `.env`.

**Contract**: Test importuje `SUPABASE_URL` **przez tę samą drogę co kod aplikacji**
(`astro:env/server`, nie `process.env`) i asertuje, że wskazuje localhost.
Importowanie `process.env` zamiast wirtualnego modułu sprawdziłoby coś innego niż
to, czego dotyczy ryzyko.

**Fallback**, jeśli test nie przechodzi: przenieść wstrzykiwanie zmiennych do
`test.env` w `vitest.config.ts` (jawne, niezależne od mechanizmu ładowania plików
`.env` przez Vite). Guard i asercja z punktu 3–4 pozostają bez zmian — zmienia się
wyłącznie źródło wartości. Ta gałąź nie unieważnia żadnej kolejnej fazy: testy
izolacji z Fazy 3 nie dotykają `astro:env` w ogóle.

### Success Criteria:

#### Automated Verification:

- `npm test` uruchamia się i wykonuje test sanity
- Test sanity przechodzi: `SUPABASE_URL` widziany przez kod aplikacji wskazuje localhost
- Guard działa: przebieg z `SUPABASE_URL` wskazującym host inny niż lokalny kończy się błędem, nie pominięciem
- `npm run lint` nadal zwraca zero błędów (nowe pliki podlegają tym samym regułom)
- `npm run check` obejmuje nowe pliki bez błędów

#### Manual Verification:

- Komunikat guardu przy złej konfiguracji jest zrozumiały bez czytania kodu i mówi, który plik poprawić
- `.env.test` nie pojawia się w `git status`

**Implementation Note**: Po tej fazie zatrzymaj się. Jeśli zadziałał fallback,
odnotuj to w `## Progress` — Faza 6 musi opisać w cookbooku ten wariant, który
faktycznie działa, a nie ten planowany.

---

## Phase 3: Izolacja danych między userami (Ryzyko #4)

### Overview

Udowodnić, że dane usera A są nieosiągalne i niemodyfikowalne dla usera B — przeciw
realnej bazie, dwiema tożsamościami, z asercjami na stan po operacji.

**Tryb: `/10x-tdd`.** Pierwsza czerwona asercja, jednym zdaniem: _„user B odczytuje
zero kart, gdy jedyna karta w bazie należy do usera A"_.

### Changes Required:

#### 1. Fixture dwóch tożsamości

**File**: `test/helpers/identities.ts` (nowy)

**Intent**: Dać każdemu testowi dwóch niezależnie uwierzytelnionych userów bez
przecieku stanu między testami.

**Contract**: Funkcja zwracająca dwa klienty Supabase z osobnymi sesjami plus ich
`userId`. Wykorzystuje `signUp()` z unikalnym adresem e-mail — działa bez klucza
serwisowego, bo `supabase/config.toml:209` wyłącza potwierdzanie adresu. Klienty
tworzone z `persistSession: false`, żeby sesje nie wyciekały między plikami testów.

#### 2. Testy izolacji na `cards`

**File**: `test/integration/cards-isolation.test.ts` (nowy)

**Intent**: Przypiąć cztery scenariusze odmowy plus dowód, że próba modyfikacji
niczego nie zmieniła.

**Contract**: Wyrocznia pochodzi z PRD Guardrail 3 (`prd.md:59`) i NFR
(`prd.md:211`) — _„nie są widoczne ani działalne"_ — przetłumaczonych na **stan po
operacji**, nie na kod odpowiedzi:

| Scenariusz                            | Asercja                                                    |
| ------------------------------------- | ---------------------------------------------------------- |
| B robi `select()`                     | zero wierszy, brak błędu                                   |
| B robi `select().eq("id", <karta A>)` | zero wierszy                                               |
| B robi `update()` na karcie A         | zero wierszy **oraz** A odczytuje swoją kartę niezmienioną |
| B robi `delete()` na karcie A         | zero wierszy **oraz** A nadal widzi swoją kartę            |
| klient bez sesji robi `select()`      | zero wierszy                                               |

Asercja „A odczytuje swoją kartę niezmienioną" jest częścią, bez której test nie
działa: pusty wynik `update()` sam w sobie nie dowodzi niczego, bo PostgREST bez
`.select()` i tak nie zwraca wierszy.

#### 3. Test `WITH CHECK` na INSERT

**File**: `test/integration/cards-isolation.test.ts`

**Intent**: Przypiąć jedyną regułę, której nic w kodzie aplikacji nie dubluje —
obronę przed rozjazdem między `context.locals.user` a tożsamością z ciasteczka.

**Contract**: A wstawia kartę z `user_id` usera B → oczekiwany błąd, kod `42501`.
To **jedyny** scenariusz tej fazy dający twardy błąd; pozostałe są ciche.

#### 4. Test izolacji na `generations`

**File**: `test/integration/generations-isolation.test.ts` (nowy)

**Intent**: Rozciągnąć dowód na drugą tabelę z danymi usera — Guardrail 3 mówi o
kartach, historii generacji i profilu, nie tylko o kartach.

**Contract**: A wstawia rekord generacji, B robi `select()` → zero wierszy.
Tabela ma tylko polityki INSERT i SELECT; brak UPDATE/DELETE jest świadomy
(komentarz w migracji `20260609211146:30-33`), więc tych operacji nie testujemy.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` przechodzi przy uruchomionym lokalnym Supabase
- Każdy test tej fazy failuje po ręcznym wyłączeniu odpowiedniej polityki RLS — sprawdzone dla co najmniej jednej polityki SELECT i jednej UPDATE
- `npm run lint` i `npm run check` nadal zielone

#### Manual Verification:

- Testy przechodzą po `npx supabase db reset` — nie zależą od stanu zostawionego przez wcześniejszy przebieg
- Dwa kolejne uruchomienia pod rząd przechodzą bez czyszczenia bazy (unikalność adresów e-mail działa)

**Implementation Note**: Kryterium „test failuje po wyłączeniu polityki" jest
ważniejsze niż „test przechodzi". Test izolacji, który przechodzi również bez RLS,
jest gorszy niż jego brak — daje fałszywe poczucie ochrony. Zweryfikuj to ręcznie
przed przejściem dalej.

---

## Phase 4: Brak wycieków wnętrzności (Ryzyko #2)

### Overview

Trzy asercje na trzech różnych warstwach, po jednej na każdą twarz Ryzyka #2.

**Tryb: `/10x-tdd`** dla punktu 1. Pierwsza czerwona asercja: _„odpowiedź endpointu
nie zawiera nazwy tabeli ani constraintu, gdy insert do bazy padnie"_.

### Changes Required:

#### 1. Redakcja błędu 500 — test hermetyczny

**File**: `test/hermetic/cards-error-redaction.test.ts` (nowy)

**Intent**: Przypiąć naprawę F5 — jedyne ryzyko tej fazy z potwierdzonym
precedensem w archiwum. Ścieżka jest nieosiągalna przez realną bazę, więc test
karmi endpoint stubem klienta.

**Contract**: Stub `createClient` zwraca z `insert()` błąd o kształcie zdjętym
z żywej bazy (`research.md` §B1):

```
{ code: "23514",
  message: 'new row for relation "cards" violates check constraint "cards_source_check"',
  details: null, hint: null }
```

Asercje na odpowiedzi endpointu: status `500`, a ciało **nie zawiera** żadnego z
ciągów `cards`, `constraint`, `violates`, `23514`. Asercja negatywna na listę
ciągów, nie porównanie z aktualną treścią komunikatu — kopiowanie oczekiwanej
wartości z implementacji dałoby test-lustro, który przechodzi także po regresji.

Stub podmienia **granicę** (klienta Supabase), nie moduł endpointu — endpoint musi
wykonać swoją realną ścieżkę błędu.

#### 2. Sekret w artefakcie builda

**File**: `test/hermetic/build-artifact.test.ts` (nowy)

**Intent**: Przypiąć deklarację `context: "server", access: "secret"` z
`astro.config.mjs:19-20` na poziomie skutku, a nie konfiguracji.

**Contract**: Test skanuje **`dist/client/**`** — nie całe `dist/`. Wartość
`SUPABASE_KEY`jest legalnie obecna w`dist/server/.dev.vars`(adapter kopiuje ten
plik), a`dist/server`nie jest publikowany, bo adapter nadpisuje`assets.directory`na`../client`. Asercja na całym `dist/` byłaby **fałszywie czerwona** i zostałaby
wyciszona przez pierwszą osobę, która ją zobaczy.

Dwie asercje: wartość `SUPABASE_KEY` nie występuje w żadnym pliku pod
`dist/client/**`; pod `dist/client/**` nie ma pliku `.dev.vars` ani `.env`.

Test **musi failować z jasnym komunikatem, gdy `dist/` nie istnieje** — inaczej
przechodzi trywialnie, bo nie ma czego przeszukać.

#### 3. Brak miejsca na tekst źródłowy

**File**: `test/integration/generations-schema.test.ts` (nowy)

**Intent**: Przypiąć PRD Guardrail 2 (`prd.md:58`) i NFR (`prd.md:208`) —
_„system zachowuje wyłącznie nieodwracalny identyfikator i długość"_ — na poziomie
schematu, zanim powstanie funkcja generacji, która mogłaby tę regułę złamać.

**Contract**: Zbiór kolumn tabeli `generations` równa się dokładnie
`{id, user_id, source_text_hash, source_text_length, created_at}`. Asercja na
równość zbioru, nie na obecność wybranych kolumn — regresja, przed którą chronimy,
polega na **dodaniu** kolumny (`source_text` „do debugowania"), a asercja
sprawdzająca tylko obecność jej nie wykryje.

### Success Criteria:

#### Automated Verification:

- `npm run test:hermetic` przechodzi po `npm run build`
- `npm run test:hermetic` **failuje** z czytelnym komunikatem, gdy `dist/` nie istnieje
- Test redakcji failuje po ręcznym przywróceniu `error.message` w `cards.ts:56` — sprawdzone
- Test schematu failuje po dodaniu testowej kolumny do `generations` w tymczasowej migracji — sprawdzone
- `npm run lint` i `npm run check` nadal zielone

#### Manual Verification:

- Ręczne wywołanie 422 przez formularz (tekst dłuższy niż 500 znaków) nadal pokazuje komunikat zamiast wysypywać wyspę — druga weryfikacja regresji F2 po zmianie z Fazy 1

**Implementation Note**: Oba kryteria „test failuje po…" wymagają celowego zepsucia
kodu i cofnięcia zmiany. Bez tego kroku nie wiadomo, czy test cokolwiek chroni.

---

## Phase 5: Ożywienie bramek CI

### Overview

Pierwszy przebieg workflow w historii tego repozytorium. Ma być zielony.

### Changes Required:

#### 1. Trigger

**File**: `.github/workflows/ci.yml`

**Intent**: Przestawić wyzwalanie z nieistniejącej gałęzi `master` na `main`.
`gh repo view` potwierdza `defaultBranchRef: main`; `gh run list` zwraca pustą listę.

**Contract**: `on.push.branches` i `on.pull_request.branches` → `[main]`.

#### 2. Krok testów

**File**: `.github/workflows/ci.yml`

**Intent**: Dołożyć do bramek CI te testy, które nie wymagają uruchomionego
Supabase. Decyzja z 2026-08-05: integracyjne zostają bramką ad hoc zgodnie z §4.

**Contract**: Krok `npm run test:hermetic` **po** kroku `npm run build` — bramka
artefaktu czyta `dist/`, więc bez tej kolejności failuje. Krok potrzebuje tych
samych sekretów co build (`SUPABASE_URL`, `SUPABASE_KEY`) plus wartości testowych;
te ostatnie są jawne (localhost + klucz lokalnego stacku) i mogą trafić do
workflow wprost, bez sekretu repozytorium.

### Success Criteria:

#### Automated Verification:

- Workflow uruchamia się na Pull Requeście do `main` — `gh run list` przestaje być pusta
- Wszystkie kroki przechodzą: `npm ci`, `astro sync`, lint, build, `test:hermetic`
- Krok lint przechodzi na runnerze Linux (potwierdza, że `.gitattributes` działa również poza Windows)

#### Manual Verification:

- Czas przebiegu jest akceptowalny (orientacyjnie poniżej 5 minut)
- Log kroku testów pokazuje, ile testów uruchomiono — zielony przebieg z zerem uruchomionych testów jest do odróżnienia od prawdziwie zielonego

---

## Phase 6: Cookbook i domknięcie

### Overview

Zamienić to, co powstało, w instrukcję dla następnej osoby — i zsynchronizować stan
rolloutu.

### Changes Required:

#### 1. Wzorce w cookbooku

**File**: `context/foundation/test-plan.md`

**Intent**: Wypełnić trzy sekcje `TBD`, które ta faza miała pokryć.

**Contract**:

- **§6.2 Test izolacji danych między userami** — przepis na fixture dwóch
  tożsamości oraz reguła, że asercja idzie na stan po operacji, bo odmowa RLS jest
  cicha (200 / `error: null` / zero wierszy).
- **§6.3 Test ścieżki błędu API** — kiedy hermetyczny a kiedy integracyjny, i
  dlaczego asercja jest negatywna na listę ciągów zamiast porównania z treścią
  komunikatu.
- **§6.5 Test dla nowego endpointu API** — domyślna warstwa, polityka stubowania
  (tylko granica, nigdy moduły wewnętrzne) i wymóg asercji na skutek uboczny.
- **§6.6** — notatka z tej fazy, w tym wariant `astro:env`, który faktycznie
  zadziałał.

#### 2. Synchronizacja stanu rolloutu

**File**: `context/foundation/test-plan.md`, `context/changes/testing-data-isolation/change.md`

**Intent**: Przesunąć status Fazy 1 na `complete` i zamknąć zmianę.

**Contract**: §3 wiersz 1 → `complete`. §5: wiersze „martwa dziś" dla lint i build
zmieniają się na wymagane. `change.md` → `status: implemented`.

#### 3. Zamknięcie wchłoniętej zmiany

**File**: `context/changes/lint-debt-cleanup/change.md`

**Intent**: Domknąć zmianę-ducha. `test-plan.md` §5 rozstrzygnął 2026-08-02, że
Faza 1 wchłania ten dług.

**Contract**: Notatka wskazująca `testing-data-isolation` jako miejsce, w którym
dług został spłacony, plus status oznaczający zamknięcie. Zmiana nie dostaje
własnego planu ani implementacji.

### Success Criteria:

#### Automated Verification:

- `test-plan.md` nie zawiera już `TBD` w §6.2, §6.3 ani §6.5
- Pełna weryfikacja końcowa przechodzi: `npm run lint && npm run check && npm run build && npm test`

#### Manual Verification:

- Wzorce z §6 dają się wykonać przez osobę, która nie brała udziału w tej fazie — sprawdzone przez przeczytanie ich bez zaglądania do kodu testów
- §3 i §5 opisują stan zgodny z rzeczywistością repozytorium

---

## Testing Strategy

### Testy hermetyczne (bez bazy, w CI):

- Redakcja błędu 500 w `POST /api/cards` — stub klienta z realnym błędem `23514`
- Brak `SUPABASE_KEY` w `dist/client/**`
- Brak `.dev.vars` / `.env` w `dist/client/**`

### Testy integracyjne (realna baza, ad hoc):

- Izolacja `cards`: select / select-po-id / update / delete usera B na zasobie A
- Stan po operacji: karta usera A nietknięta po próbach modyfikacji
- `WITH CHECK`: INSERT z cudzym `user_id` → `42501`
- Izolacja `generations`: B nie widzi rekordów A
- Klient bez sesji: zero wierszy
- Schemat `generations`: zbiór kolumn równy oczekiwanemu

### Kroki weryfikacji ręcznej:

1. Po Fazie 1: dodać kartę przez formularz; wywołać błąd walidacji i sprawdzić, że
   wyspa React nie pada (regresja F2)
2. Po Fazie 2: uruchomić suitę z `SUPABASE_URL` wskazującym produkcję i potwierdzić,
   że guard ubija przebieg z czytelnym komunikatem
3. Po Fazie 3: wyłączyć jedną politykę RLS i potwierdzić, że odpowiedni test failuje
4. Po Fazie 4: przywrócić `error.message` w `cards.ts` i potwierdzić, że test
   redakcji failuje
5. Po Fazie 5: otworzyć Pull Request do `main` i obejrzeć pierwszy przebieg CI

## Performance Considerations

Testy integracyjne zakładają nowe konto per przebieg, więc tabela `auth.users`
lokalnej bazy rośnie. Przy dogfoodingu N=1 to bez znaczenia; jeśli przebiegi staną
się częste, `npx supabase db reset` czyści stan. Świadomie **nie** dodajemy
sprzątania po testach — usuwanie kont wymagałoby klucza serwisowego, czyli
wprowadzenia do suity poświadczeń omijających RLS, których żaden test tej fazy nie
potrzebuje.

## Migration Notes

Renormalizacja końców linii to jedyna zmiana o zasięgu całego repozytorium.
Wykonana jako osobny commit, bez zmian semantycznych. Otwarte Pull Requesty #1
(F-02) i #2 (S-03) będą wymagały rebase'u; konflikty będą wyłącznie na końcach
linii.

## References

- Research: `context/changes/testing-data-isolation/research.md`
- Strategia i rollout: `context/foundation/test-plan.md` §1–§5
- Precedens Ryzyka #2: `context/archive/2026-06-09-db-schema-mvp/reviews/impl-review.md` §F5
- Precedens crashu formularza: tamże §F2
- Wyrocznia: `context/foundation/prd.md:58` (Guardrail 2), `:59` (Guardrail 3), `:208`, `:211` (NFR)
- Reguły zespołu: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Higiena repozytorium — końce linii i dług lintowy

#### Automated

- [x] 1.1 `npm run lint` zwraca zero błędów — ba1a0e6
- [x] 1.2 `npm run check` nadal zwraca zero błędów — ba1a0e6
- [x] 1.3 `npm run build` nadal przechodzi — ba1a0e6
- [x] 1.4 `npm ls zod` nie zgłasza konfliktu wersji — ba1a0e6
- [x] 1.5 Commit renormalizacyjny nie zawiera zmian semantycznych — c552e38

#### Manual

- [x] 1.6 Formularz dodawania karty działa; błąd walidacji nie wysypuje wyspy React — ba1a0e6
- [x] 1.7 Dashboard wyświetla listę kart zalogowanego usera — ba1a0e6

### Phase 2: Runner + guard środowiskowy

#### Automated

- [x] 2.1 `npm test` uruchamia się i wykonuje test sanity — 3685ba8
- [x] 2.2 Test sanity przechodzi: `SUPABASE_URL` widziany przez kod aplikacji wskazuje localhost — 3685ba8
- [x] 2.3 Guard ubija przebieg przy nielokalnym `SUPABASE_URL` — 3685ba8
- [x] 2.4 `npm run lint` nadal zwraca zero błędów — 3685ba8
- [x] 2.5 `npm run check` obejmuje nowe pliki bez błędów — 3685ba8

#### Manual

- [x] 2.6 Komunikat guardu jest zrozumiały i wskazuje plik do poprawy — 3685ba8
- [x] 2.7 `.env.test` nie pojawia się w `git status` — 3685ba8

### Phase 3: Izolacja danych między userami (Ryzyko #4)

#### Automated

- [x] 3.1 `npm run test:integration` przechodzi przy uruchomionym Supabase — e804560
- [x] 3.2 Testy failują po wyłączeniu polityki RLS (SELECT i UPDATE) — kryterium skorygowane w trakcie: właściwą mutacją jest **osłabienie** polityki (`using (true)`), nie jej usunięcie; usunięcie czyni bazę bardziej restrykcyjną i testy słusznie przechodzą — e804560
- [x] 3.3 `npm run lint` i `npm run check` nadal zielone — e804560

#### Manual

- [x] 3.4 Testy przechodzą po `npx supabase db reset` — e804560
- [x] 3.5 Dwa kolejne przebiegi pod rząd przechodzą bez czyszczenia bazy — e804560

### Phase 4: Brak wycieków wnętrzności (Ryzyko #2)

#### Automated

- [x] 4.1 `npm run test:hermetic` przechodzi po `npm run build` — 96acf4f
- [x] 4.2 `npm run test:hermetic` failuje czytelnie, gdy `dist/` nie istnieje — 96acf4f
- [x] 4.3 Test redakcji failuje po przywróceniu `error.message` w `cards.ts` — 96acf4f
- [x] 4.4 Test schematu failuje po dodaniu kolumny do `generations` — 96acf4f
- [x] 4.5 `npm run lint` i `npm run check` nadal zielone — 96acf4f

#### Manual

- [x] 4.6 Ręczne 422 przez formularz nie wysypuje wyspy React — 96acf4f — zaliczone bez powtórki (decyzja 2026-08-06): Faza 4 nie dotknęła kodu produkcyjnego, sprawdzone ręcznie w Fazie 1, a kontrakt `error` jako string pilnuje teraz test hermetyczny

### Phase 5: Ożywienie bramek CI

#### Automated

- [ ] 5.1 Workflow uruchamia się na Pull Requeście do `main`
- [ ] 5.2 Wszystkie kroki przechodzą: `npm ci`, `astro sync`, lint, build, `test:hermetic`
- [ ] 5.3 Krok lint przechodzi na runnerze Linux

#### Manual

- [ ] 5.4 Czas przebiegu poniżej ~5 minut
- [ ] 5.5 Log kroku testów pokazuje liczbę uruchomionych testów

### Phase 6: Cookbook i domknięcie

#### Automated

- [ ] 6.1 `test-plan.md` nie zawiera `TBD` w §6.2, §6.3 ani §6.5
- [ ] 6.2 Weryfikacja końcowa: `npm run lint && npm run check && npm run build && npm test`

#### Manual

- [ ] 6.3 Wzorce z §6 są wykonalne bez zaglądania do kodu testów
- [ ] 6.4 §3 i §5 opisują stan zgodny z rzeczywistością repozytorium
