---
date: 2026-08-04T21:55:00+02:00
researcher: Marcin
git_commit: d0b6d0bf4cea7fc5db5e0a756e996a51e528b3ca
branch: main
repository: 10xCards
topic: "Runner + izolacja danych i brak wycieków (test-plan §3 Phase 1, ryzyka #2 i #4)"
tags: [research, codebase, rls, supabase, vitest, ci, lint, cloudflare, security]
status: complete
last_updated: 2026-08-04
last_updated_by: Marcin
---

# Research: Runner + izolacja danych i brak wycieków (test-plan §3 Phase 1)

**Date**: 2026-08-04T21:55:00+02:00
**Researcher**: Marcin
**Git Commit**: `d0b6d0bf4cea7fc5db5e0a756e996a51e528b3ca` (nie wypchnięty — `main` jest ahead 2 wobec `origin/main`, dlatego w dokumencie są ścieżki lokalne, nie permalinki GitHub)
**Branch**: main
**Repository**: 10xCards (`https://github.com/Marcin-git99/10xcards30`)

## Research Question

Czym trzeba udowodnić Ryzyko #2 (wewnętrzne szczegóły systemu wyciekają na zewnątrz)
i Ryzyko #4 (dane jednego usera widoczne lub modyfikowalne przez innego), gdzie te
reguły są dziś faktycznie egzekwowane, i co musi się zdarzyć, żeby runner oraz
martwe bramki lint/build w ogóle mogły zacząć cokolwiek znaczyć?

## Summary

Research potwierdza wszystkie założenia `test-plan.md` §3 Phase 1 i dokłada do nich
sześć faktów, których plan nie mógł znać. Cztery z nich zmieniają kształt testów,
które trzeba napisać.

1. **Odmowa RLS jest cicha.** Empirycznie zweryfikowane na lokalnej bazie: gdy user B
   próbuje odczytać, zaktualizować albo usunąć kartę usera A, PostgREST zwraca
   **HTTP 200, `error: null` i zero wierszy** — nie 403, nie wyjątek. Test Ryzyka #4
   napisany jako „oczekuj błędu" **przeszedłby też na bazie bez RLS**, gdyby dane
   nie istniały. Wyrocznia musi brzmieć: _zero wierszy zwróconych ORAZ wiersz usera A
   niezmieniony po próbie_. Wyjątkiem jest INSERT — sfałszowanie `user_id` daje
   twarde 403 / `42501`.
2. **Ścieżka błędu 500 w `POST /api/cards` jest dziś nieosiągalna przez realną bazę.**
   Zod domyślnie _usuwa_ nieznane pola, więc klient nie ma jak wywołać naruszenia
   CHECK-a. To dokładnie przypadek z §Two-layer strategy: Ryzyko #2 na warstwie API
   należy do testów **hermetycznych** ze stubem klienta, nie do integracyjnych.
   Realny kształt błędu, którym trzeba nakarmić stub, jest w tym dokumencie —
   zdjęty z żywej bazy, nie zmyślony.
3. **`.env` i `.dev.vars` wskazują produkcyjny projekt Supabase.** Każdy test, który
   zaimportuje `@/lib/supabase` bez nadpisania środowiska, uderzy w produkcję —
   łącznie z zakładaniem dwóch testowych kont. To najpoważniejsze ryzyko wykonawcze
   tej fazy i musi zostać zamknięte, zanim powstanie pierwszy test.
4. **Bramka „sekret w bundlu" wymaga precyzyjnego celu.** Produkcyjny `SUPABASE_KEY`
   _jest_ obecny w artefakcie builda — w `dist/server/.dev.vars`. Naiwna asercja
   „grep całego `dist/`" świeciłaby na czerwono z powodu pliku, który nigdy nie jest
   publikowany. Właściwym celem jest `dist/client/**`.
5. **Dług lintowy to w 99% CRLF, nie kod.** 1050 błędów, z czego 1039 to
   `prettier/prettier` „Delete `␍`". Realnych naruszeń reguł jest **dziewięć**,
   w dwóch plikach. Bez `.gitattributes` naprawa jest nietrwała.
6. **`zod` jest niezadeklarowaną zależnością.** `src/pages/api/cards.ts` importuje
   `zod`, ale nie ma go ani w `dependencies`, ani w `devDependencies` — działa
   wyłącznie dzięki hoistingowi tranzytywnej zależności z `astro@6.3.1`. Faza,
   która ożywia bramkę build, powinna to domknąć.

Bramka typecheck jest zielona (`astro check`: 0 errors), a `npm run build` przechodzi.
CI nie uruchomiło się nigdy — `gh run list` zwraca pustą listę, co potwierdza §5 fakt #1.

## Detailed Findings

### A. Gdzie faktycznie mieszka Ryzyko #4 (izolacja danych)

Egzekwowanie własności zasobu jest dziś **w całości w bazie**. W kodzie aplikacji nie
ma ani jednego filtra po `user_id` przy odczycie:

- [dashboard.astro:12](src/pages/dashboard.astro:12) — `supabase.from("cards").select()`
  bez żadnego `.eq("user_id", …)`. Cała lista kart na dashboardzie opiera się
  wyłącznie na RLS. Gdyby polityki zniknęły, ten jeden select wyświetliłby karty
  wszystkich userów.
- [cards.ts:50](src/pages/api/cards.ts:50) — zapis bierze `user_id` z
  `context.locals.user.id`, **nigdy z ciała żądania**. Powierzchni IDOR przez
  podmianę identyfikatora w payloadzie dziś nie ma.
- Endpointów `GET`/`PUT`/`DELETE` dla kart **nie ma** — [cards.ts](src/pages/api/cards.ts)
  eksportuje wyłącznie `POST`. Klasyczny IDOR „podmień `id` w URL-u" nie ma dziś
  gdzie zaistnieć na warstwie HTTP. To przesuwa ciężar testu na warstwę bazy.

Polityki RLS ([20260604000000_create_cards.sql:12-31](supabase/migrations/20260604000000_create_cards.sql:12))
są per-operation, per-role, wyłącznie dla `authenticated` — zgodnie z konwencją z
`CLAUDE.md`. Rola `anon` nie ma żadnej polityki, więc obowiązuje default-deny.

Tabela `generations` ([20260609211146:20-33](supabase/migrations/20260609211146_reshape_schema_to_prd_model.sql:20))
ma tylko INSERT i SELECT; brak UPDATE/DELETE jest świadomy i udokumentowany w migracji.

#### Subtelność, którą test musi przypiąć: dwa niezależne źródła tożsamości

`user_id` zapisywany do bazy pochodzi z `context.locals.user` (ustawianego przez
[middleware.ts:13](src/middleware.ts:13)), natomiast tożsamość, którą sprawdza RLS,
pochodzi z ciasteczka przekazanego do
[createClient](src/lib/supabase.ts:5). To dwa niezależne kanały. Gdyby się rozjechały,
jedyną obroną jest `WITH CHECK (user_id = auth.uid())` na polityce INSERT — i to jest
asercja warta przypięcia, bo dziś nic w kodzie jej nie dubluje.

#### Wyniki empiryczne (lokalna baza, `127.0.0.1:54321`, sonda badawcza)

Dwóch świeżo założonych userów, jedna karta usera A. Wyniki są **wyrocznią** dla
testów tej fazy:

| Operacja usera B na zasobie usera A              | HTTP | `error` | Wiersze |
| ------------------------------------------------ | ---- | ------- | ------- |
| `select()` (wszystkie karty)                     | 200  | `null`  | 0       |
| `select().eq("id", <karta A>)`                   | 200  | `null`  | 0       |
| `update({question:"PWNED"}).eq("id", <karta A>)` | 200  | `null`  | 0       |
| `delete().eq("id", <karta A>)`                   | 200  | `null`  | 0       |
| `select()` na `generations`                      | 200  | `null`  | 0       |
| `select()` bez sesji (rola `anon`)               | 200  | `null`  | 0       |

Po każdej z tych prób user A odczytał swoją kartę bez zmian (`question` nadal `"Q-A"`).

Jedyna operacja dająca twardy błąd — INSERT z cudzym `user_id`:

```
status 403, code "42501"
message: 'new row violates row-level security policy for table "cards"'
```

**Konsekwencja dla planu.** Test „user B nie dosięga danych usera A" nie może
asertować wyjątku. Musi asertować `data.length === 0` **oraz** — to jest część, którą
łatwo pominąć — że po próbie UPDATE/DELETE wiersz usera A odczytany _przez usera A_
jest nadal nietknięty. Sam pusty wynik `update()` jest niewystarczającym dowodem: bez
`.select()` PostgREST i tak nie zwróciłby wierszy.

### B. Gdzie mieszka Ryzyko #2 (wyciek wnętrzności) — trzy różne twarze

Test-plan §2 opisuje Ryzyko #2 jako trzy scenariusze. Research pokazuje, że mają
**trzy różne, rozłączne miejsca egzekwowania i trzy różne warstwy testu**.

#### B1. Surowy błąd bazy w odpowiedzi API — dziś zredagowany, ale nieosiągalny integracyjnie

Precedens: [impl-review.md §F5](context/archive/2026-06-09-db-schema-mvp/reviews/impl-review.md)
— endpoint zwracał `error.message` z bazy wprost do klienta. Naprawione:
[cards.ts:54-60](src/pages/api/cards.ts:54) loguje po stronie serwera i zwraca
generyczne `"Failed to create card"`.

Co dokładnie wyciekłoby po regresji — zdjęte z żywej bazy:

```
code "23514"
message: 'new row for relation "cards" violates check constraint "cards_source_check"'
details: null
```

Czyli: nazwa tabeli + nazwa constraintu. `details` jest `null`, więc **tekst usera nie
przecieka** w tym wariancie (sprawdzone także dla naruszenia `leitner_box` z
niepustym `question` — `details` nadal `null`).

**Kluczowe ustalenie o osiągalności.** Schema `createCardSchema`
([cards.ts:8-11](src/pages/api/cards.ts:8)) to zwykły `z.object` bez `.strict()` —
zod **usuwa nieznane pola**, więc do `insert()` trafiają wyłącznie `question` i
`answer` (plus `user_id` z sesji). Długość jest ograniczona do 500 przez zod, `NOT NULL`
jest zaspokojone. **Nie ma dziś legalnego żądania HTTP, które doprowadziłoby do
naruszenia CHECK-a.** Gałąź `if (error)` w linii 54 jest osiągalna tylko przy awarii
infrastruktury.

To jest podręcznikowy przypadek z §Two-layer strategy: _„partial failures that real
infra cannot trigger easily"_ → **test hermetyczny ze stubem klienta Supabase**,
zwracającym powyższy kształt błędu, z asercją że treść odpowiedzi **nie zawiera**
`"cards"`, `"constraint"`, `"violates"`, `"23514"`, i że status to 500. Test
integracyjny na tę ścieżkę byłby próbą wymuszenia stanu, którego produkcja nie
osiąga.

#### B2. Sekret w artefakcie builda — zamknięte, ale mylące

`SUPABASE_URL`/`SUPABASE_KEY` są zadeklarowane jako `context: "server", access: "secret"`
w [astro.config.mjs:19-20](astro.config.mjs:19). Weryfikacja na świeżym buildzie:

- Wartość `SUPABASE_KEY` **nie występuje** w żadnym pliku pod `dist/client/**`.
- Wartość `SUPABASE_KEY` **występuje** w `dist/server/.dev.vars` — adapter Cloudflare
  kopiuje ten plik do katalogu serwerowego.

Czy `dist/server/.dev.vars` jest publikowany? **Nie**, z dwóch niezależnych powodów:

1. `wrangler.jsonc` w repo deklaruje `assets.directory: "./dist"`
   ([wrangler.jsonc:11](wrangler.jsonc:11)), ale adapter Astro **nadpisuje to przy
   buildzie** — wygenerowany `dist/server/wrangler.json` ma
   `"assets":{"directory":"../client"}`. Publikowany jest więc wyłącznie `dist/client`.
2. Wrangler i tak domyślnie pomija pliki i katalogi ukryte (potwierdzone w
   dokumentacji Cloudflare przez Context7, 2026-08-04).

Weryfikacja na żywym wdrożeniu (`https://10xcards30.turolmar1-775.workers.dev`):
`/server/.dev.vars` → **404**, `/.dev.vars` → **404**, `/` → 200.

**Konsekwencja dla planu.** Bramka artefaktu musi celować w `dist/client/**`, nie w
`dist/`. Asercja „nigdzie w `dist/` nie ma sekretu" jest **fałszywie czerwona** i
zostałaby wyciszona przez pierwszą osobę, która ją zobaczy. Dodatkowa asercja warta
grosza: `dist/client/**` nie zawiera pliku o nazwie `.dev.vars` ani `.env`.

Warto odnotować rozbieżność: `wrangler.jsonc` w repo mówi `"./dist"`, a efektywna
konfiguracja to `"../client"`. Zapis w repo jest mylący — ktoś „porządkujący" konfig
mógłby przypadkiem opublikować katalog serwerowy.

#### B3. Tekst źródłowy usera w operator-accessible storage — dziś tylko strukturalnie

Wyrocznia jest jednoznaczna i pochodzi z dwóch niezależnych miejsc PRD:

- [prd.md:58](context/foundation/prd.md:58) (Guardrail 2) — _„Wklejony przez usera
  tekst źródłowy nie pozostawia śladu w operator-accessible storage […]; system
  zachowuje wyłącznie nieodwracalny identyfikator i długość."_
- [prd.md:208](context/foundation/prd.md:208) (NFR) — to samo, sformułowane jako
  wymaganie niefunkcjonalne.

Schema już to spełnia: `generations` ma wyłącznie `id`, `user_id`, `source_text_hash`,
`source_text_length`, `created_at`
([migracja:10-16](supabase/migrations/20260609211146_reshape_schema_to_prd_model.sql:10)),
co potwierdza też [types.ts:14](src/types.ts:14).

Ale **funkcja generacji nie istnieje** — nigdzie w `src/` nie ma zapisu do
`generations`. Jedyne, co da się dziś przetestować, to **asercja strukturalna**: zbiór
kolumn `generations` nie zawiera kolumny mogącej pomieścić tekst źródłowy. Test
zachowania należy do slice'a S-01, nie do tej fazy. Warto go napisać mimo to — jest
tani i łapie regresję typu „dodajmy sobie `source_text` do debugowania".

#### B4. Twarz Ryzyka #2, której test-plan nie wymienia — i którą należy zostawić Fazie 2

[signin.ts:16](src/pages/api/auth/signin.ts:16) i
[signup.ts:16](src/pages/api/auth/signup.ts:16) wstawiają `error.message` od dostawcy
auth **do parametru URL** przekierowania:

```ts
return context.redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`);
```

To ta sama klasa co F5 (komunikat dostawcy przekazany klientowi dosłownie), z
dodatkowym kosztem: parametry URL lądują w historii przeglądarki i logach warstwy
brzegowej. Komunikaty Supabase rozróżniają też przypadki w sposób sprzyjający
enumeracji kont (`"User already registered"`).

**Rekomendacja: nie testować tego w Fazie 1.** `context/changes/google-oauth-switch/`
przepisuje dokładnie tę ścieżkę (F-02), a test-plan §3 świadomie sekwencjonuje ją do
Fazy 2. Test napisany teraz celowałby w kod przeznaczony do usunięcia — to
antywzorzec, przed którym ostrzega uzasadnienie kolejności w §3. Ustalenie należy
przenieść do researchu Fazy 2 jako gotowe wejście.

### C. Warunki wykonawcze — co blokuje pierwszy test

#### C1. `.env` wskazuje produkcję (blokujące)

```
.env       -> SUPABASE_URL=https://zrsywmnzmbpvptkhaayf.supabase.co
.dev.vars  -> SUPABASE_URL=https://zrsywmnzmbpvptkhaayf.supabase.co
```

To ten sam projekt, który obsługuje żywe wdrożenie (wg pamięci projektu: Supabase
`10xCards30`, AWS eu-central-1). `src/lib/supabase.ts` czyta `astro:env/server`, więc
**każdy test importujący ten moduł bez nadpisania środowiska łączy się z produkcją** —
a testy izolacji z natury zakładają konta i piszą wiersze.

Lokalny stack działa i jest gotowy (`supabase status`: API `127.0.0.1:54321`,
DB `127.0.0.1:54322`). `supabase status -o env` udostępnia maszynowo `API_URL`,
`ANON_KEY`, `PUBLISHABLE_KEY`, `SERVICE_ROLE_KEY`, `SECRET_KEY`, `DB_URL` — czyli
konfigurację testową da się wygenerować bez ręcznego kopiowania kluczy.

**Rekomendacja (dwie warstwy, obie tanie):**

1. Osobny plik środowiska testowego z URL-em `127.0.0.1`.
2. **Twardy guard w setupie testów**: jeżeli rozwiązany `SUPABASE_URL` nie wskazuje
   `127.0.0.1`/`localhost` — przerwij cały przebieg. Sama konfiguracja jest cicha,
   guard krzyczy. Bez niego pierwszy błąd w rozwiązywaniu env-a jest niezauważalny
   aż do momentu, w którym w produkcji pojawią się konta `probe_…@example.com`.

Czy `astro:env/server` w Vitest podchwyci plik `.env.test` — patrz Open Questions.

#### C2. Zakładanie dwóch tożsamości jest tanie

`supabase/config.toml:209` → `[auth.email] enable_confirmations = false`, a
`minimum_password_length = 6`. Zwykłe `signUp()` zwraca od razu sesję (potwierdzone
empirycznie: `hasSession: true` dla obu userów). **Klucz serwisowy ani Admin API nie
są potrzebne** do zestawienia dwóch tożsamości — wystarczy klucz publiczny i dwa
niezależne klienty z `persistSession: false`.

#### C3. Dług lintowy — mniejszy i innego rodzaju, niż zakłada §5

`npx eslint .` → **1050 błędów + 1 ostrzeżenie w 30 plikach**. Rozkład:

| Reguła                                            | Liczba |
| ------------------------------------------------- | ------ |
| `prettier/prettier` — „Delete `␍`" (CRLF)         | 1039   |
| `prettier/prettier` — realne formatowanie         | 2      |
| `@typescript-eslint/no-unsafe-assignment`         | 3      |
| `@typescript-eslint/no-unsafe-member-access`      | 2      |
| `@typescript-eslint/no-deprecated`                | 2      |
| `@typescript-eslint/no-confusing-void-expression` | 1      |
| `@typescript-eslint/no-unnecessary-condition`     | 1      |
| `no-console` (severity: **warning**, nie błąd)    | 1      |

Wszystkie realne naruszenia mieszczą się w dwóch plikach:
[CreateCardForm.tsx](src/components/cards/CreateCardForm.tsx) (6 błędów wokół
nietypowanej odpowiedzi `fetch` w liniach 42–50 oraz przestarzały `React.FormEvent`),
[cards.ts:34](src/pages/api/cards.ts:34) (`z.flatten()` → `z.treeifyError()`) i
[dashboard.astro:13](src/pages/dashboard.astro:13) (zbędne `??`).

**Przyczyna 1039 błędów CRLF**: `git config core.autocrlf` = `true`, w repo **nie ma
`.gitattributes`**, a `.prettierrc.json` nie ustawia `endOfLine` (domyślnie `"lf"`).
Pliki są w drzewie roboczym CRLF-owe, prettier oczekuje LF.

Dwa wnioski, które zmieniają kształt naprawy:

- **Sam `prettier --write` nie wystarczy.** Bez `.gitattributes` z `eol=lf` (albo bez
  `endOfLine: "auto"` w konfiguracji prettiera) następny `git checkout` na Windows
  przywróci CRLF i bramka znów będzie martwa. To nie jest jednorazowe sprzątanie,
  tylko decyzja konfiguracyjna.
- **Na CI ten dług prawie nie istnieje.** Runner jest na Ubuntu, checkout daje LF,
  więc 1039 błędów CRLF tam nie wystąpi. CI po naprawie triggera failowałby na
  **dziewięciu** realnych błędach, nie na 1050. §5 opisuje dług jako „lint failuje
  w całym repozytorium" — to prawda lokalnie na Windows, ale nie jest to obraz tego,
  co zobaczy CI.

`no-console` w [cards.ts:55](src/pages/api/cards.ts:55) to **ostrzeżenie**, nie błąd —
naprawa F5 nie łamie bramki lint. Warto to wiedzieć, zanim ktoś „posprząta"
`console.error` i tym samym cofnie F5.

#### C4. Bramka build i trigger CI

- `npm run build` → **przechodzi** (32 s). Jedyne ostrzeżenie: brak opcji `site`
  dla integracji sitemap — kosmetyczne.
- `npm run check` (`astro check`) → **0 errors, 0 warnings, 6 hints**. Bramka
  typecheck jest zielona i już dziś coś znaczy.
- Trigger CI: [ci.yml:4-7](.github/workflows/ci.yml:4) nasłuchuje na `master`;
  `gh repo view` potwierdza `defaultBranchRef: main`. **`gh run list` zwraca pustą
  listę** — workflow nie uruchomił się dotąd ani razu. Fakt #1 z §5 potwierdzony
  empirycznie, nie tylko z lektury pliku.
- Do `ci.yml` trzeba będzie dopisać krok testów. Uwaga wykonawcza: kroki testowe
  wymagające lokalnego Supabase nie pobiegną na runnerze bez wystartowania stacku
  (`supabase start`) — a §4 dopuszcza trzymanie bramki integracyjnej jako **ad hoc**,
  poza każdym commitem. Decyzja o tym, ile z tej fazy trafia do CI, należy do planu.

#### C5. `zod` jest niezadeklarowaną zależnością

[cards.ts:2](src/pages/api/cards.ts:2) importuje `zod`, a `package.json` nie wymienia
go ani w `dependencies`, ani w `devDependencies`. Rozwiązuje się do `zod@4.4.3`
wyłącznie przez hoisting z `astro@6.3.1` i `@astrojs/sitemap`. Dziś build przechodzi,
bo `npm ci` odtwarza dokładnie ten lockfile — ale bump majora zoda w Astro albo zmiana
strategii hoistingu wywraca build bez żadnej zmiany w kodzie aplikacji. Faza, która
bierze odpowiedzialność za ożywienie bramki build, jest właściwym miejscem, żeby to
domknąć jednym wpisem w `package.json`.

### D. Runner — co jest ustalone, a co trzeba rozstrzygnąć

Ustalone z dokumentacji Astro (Context7, zweryfikowane 2026-08-04):

- Integracja Vitest przez `getViteConfig()` z `astro/config` — potwierdza §4.
- **Astro 6 nie pozwala renderować komponentów `.astro` w klienckich środowiskach
  Vitest** → `test.environment: 'node'`. Potwierdza §4.
- Container API udostępnia `renderToResponse(Endpoint, { routeType: "endpoint" })` do
  testowania endpointów — istnieje, ale jest oznaczone jako eksperymentalne, a §4
  wyklucza warstwę prezentacji z tego rolloutu.

Do rozstrzygnięcia w `/10x-plan` — **warstwa dla testów izolacji**. Research
rekomenduje rozbicie, nie wybór jednej:

| Co testujemy                                        | Warstwa                                                                         | Dlaczego                                                                                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ryzyko #4 — izolacja między userami                 | Dwóch klientów Supabase wprost przeciw lokalnej bazie, **bez bootowania Astro** | Reguła jest egzekwowana w bazie (sekcja A). Przepuszczanie jej przez Astro dokłada koszt i punkty awarii, nie dokładając sygnału. Mockowanie tej warstwy byłoby antywzorcem wprost wymienionym w §Risk Response Guidance. |
| Ryzyko #4 — `WITH CHECK` na INSERT                  | j.w.                                                                            | Jedyny scenariusz dający twardy błąd; broni rozjazdu locals vs ciasteczko (sekcja A).                                                                                                                                     |
| Ryzyko #2 / B1 — redakcja błędu 500                 | Hermetycznie: import route'a `POST` + stub `createClient`                       | Ścieżka nieosiągalna przez realną infrastrukturę (sekcja B1).                                                                                                                                                             |
| Ryzyko #2 / B2 — sekret w bundlu                    | Asercja na artefakcie po `npm run build`, celowana w `dist/client/**`           | Deterministyczna, tania, łapie regresję konfiguracji `astro:env`.                                                                                                                                                         |
| Ryzyko #2 / B3 — brak tekstu źródłowego w schemacie | Asercja strukturalna na kolumnach `generations`                                 | Zachowania nie ma czego testować, dopóki nie ma generacji.                                                                                                                                                                |

Test hermetyczny B1 jest jedynym, który wymaga rozwiązania `astro:env/server` w
Vitest — czyli jedynym zależnym od Open Question #1. Testy izolacji nie dotykają
`astro:env` w ogóle, więc mogą powstać niezależnie, nawet jeśli konfiguracja runnera
okaże się kłopotliwa.

## Code References

- `src/pages/api/cards.ts:8-11` — `z.object` bez `.strict()`; usuwa nieznane pola, przez co ścieżka błędu CHECK jest nieosiągalna przez HTTP
- `src/pages/api/cards.ts:50` — `user_id` z sesji, nigdy z ciała żądania
- `src/pages/api/cards.ts:54-60` — naprawa F5: log serwerowy + generyczny komunikat (chroniona regresja Ryzyka #2)
- `src/pages/api/cards.ts:34` — `result.error.flatten()`, przestarzałe w zod 4 (`no-deprecated`)
- `src/pages/dashboard.astro:12` — `select()` bez filtra po userze; jedyna obrona to RLS
- `src/middleware.ts:13-16` — `context.locals.user` z `supabase.auth.getUser()`
- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard"]`; API kart nie jest tu wymienione (własna bramka w endpoint'cie, linie 14-20)
- `src/lib/supabase.ts:3` — `astro:env/server`, punkt, w którym testy mogą nieświadomie wejść na produkcję
- `src/pages/api/auth/signin.ts:16`, `src/pages/api/auth/signup.ts:16` — `error.message` w parametrze URL (twarz Ryzyka #2 przeznaczona dla Fazy 2)
- `supabase/migrations/20260604000000_create_cards.sql:12-31` — cztery polityki RLS per-operation dla `authenticated`
- `supabase/migrations/20260609211146_reshape_schema_to_prd_model.sql:10-33` — `generations` bez kolumny na tekst źródłowy; komentarz uzasadniający brak UPDATE/DELETE
- `astro.config.mjs:19-20` — `SUPABASE_URL`/`SUPABASE_KEY` jako `context: "server", access: "secret"`
- `wrangler.jsonc:11` — `assets.directory: "./dist"` w repo; efektywnie nadpisane przez adapter na `../client`
- `.github/workflows/ci.yml:4-7` — trigger na `master` przy domyślnej gałęzi `main`
- `package.json:15-36` — brak `zod` w zadeklarowanych zależnościach

## Architecture Insights

- **Cały ciężar Ryzyka #4 spoczywa na jednej warstwie.** Aplikacja nie duplikuje
  reguły własności w kodzie — żaden odczyt nie filtruje po `user_id`. To dobra
  architektura (jedno miejsce prawdy), ale oznacza, że pojedyncza pomyłka w migracji
  jest natychmiast wyciekiem wszystkich danych. Test musi celować dokładnie w tę
  warstwę i nie wolno jej mockować.
- **Rozstrzelona bramka autoryzacji.** Strony chroni `PROTECTED_ROUTES` w middleware,
  a endpoint kart sprawdza `locals.user` u siebie. Dwie bramki, dwa mechanizmy —
  dokładnie to, przed czym ostrzega §Risk Response Guidance dla Ryzyka #3.
  Odnotowane jako wejście do Fazy 2.
- **Cichość odmowy RLS to własność, nie usterka** — PostgREST nie potwierdza
  istnienia cudzego wiersza. Dobre dla bezpieczeństwa, kosztowne dla testów: brak
  sygnału negatywnego trzeba zastąpić asercją na stan po operacji.
- **Redakcja błędu istnieje w jednym miejscu i nie ma nazwy.** Wzorzec z F5 jest
  wklejony inline w `cards.ts`; nie ma helpera ani konwencji. Każdy kolejny endpoint
  powtórzy decyzję od zera — albo jej nie powtórzy. Kandydat na wpis w §6.5 cookbooka,
  ewentualnie na wydzielenie helpera przy trzecim endpoint'cie.
- **Konfiguracja Cloudflare ma dwa źródła prawdy** (`wrangler.jsonc` w repo vs
  wygenerowany `dist/server/wrangler.json`), które różnią się w polu decydującym o tym,
  co jest publicznie serwowane.

## Historical Context (from prior changes)

- `context/archive/2026-06-09-db-schema-mvp/reviews/impl-review.md` §F5 — potwierdzony
  wyciek surowego `error.message` z bazy. Naprawiony, ale **nieobwarowany testem** —
  to jedyne ryzyko z tej fazy mające udokumentowany precedens.
- Tamże §F4 — descope bramki lint, który powołał do życia
  `context/changes/lint-debt-cleanup/`. Zgodnie z decyzją z `test-plan.md` §5
  (2026-08-02) ta zmiana zostaje wchłonięta przez `testing-data-isolation` i powinna
  zostać zamknięta.
- Tamże §F2 — crash formularza przy 422 (obiekt zod renderowany jako React child).
  Naprawiony guardem `typeof data.error === "string"`
  ([CreateCardForm.tsx:50](src/components/cards/CreateCardForm.tsx:50)) — również bez
  testu. Leży na granicy tej fazy: to reakcja klienta na kształt odpowiedzi błędu.
  Wart odnotowania przy pisaniu testów ścieżki błędu, ale sam w sobie należy do
  warstwy prezentacji, którą §4 wyklucza z tego rolloutu.
- `context/foundation/lessons.md` — cztery zapisane reguły. Jedna dotyczy tej fazy
  bezpośrednio: _„Install deps from inside the worktree"_ — jeśli plan sięgnie po
  równoległe worktree, instalacja zależności runnera musi iść z ich wnętrza.

## Related Research

- `context/changes/google-oauth-switch/research.md` — ścieżka logowania i kształt
  sesji; wejście do Fazy 2. Ustalenie B4 (komunikaty dostawcy auth w URL) należy tam
  przenieść.
- `context/foundation/test-plan.md` §2 Risk Response Guidance — wiersze dla Ryzyk #2
  i #4; ten research jest ich ugruntowaniem w kodzie.

## Open Questions

1. **Czy `astro:env/server` w Vitest podchwyci testowy plik środowiska?**
   `getViteConfig()` uruchamia wtyczkę env Astro, ale nie zweryfikowano, czy przy
   `mode=test` rozwiąże `.env.test` zamiast `.env`. Metoda weryfikacji: jednolinijkowy
   test asertujący, że zaimportowany `SUPABASE_URL` wskazuje `127.0.0.1`. Jeśli nie —
   alternatywy to `test.env` w konfiguracji Vitest albo mock modułu
   `@/lib/supabase`. **To pytanie blokuje wyłącznie test hermetyczny B1**; testy
   izolacji są od niego niezależne.
2. **Ile z tej fazy trafia do CI, a ile zostaje ad hoc?** §4 dopuszcza bramkę
   integracyjną jako ad hoc, bo lokalna infrastruktura jest kosztowna. Testy izolacji
   wymagają działającego Supabase; hermetyczne i asercja na artefakcie builda — nie.
   Naturalny podział: hermetyczne + artefakt na każdym pushu, integracyjne ad hoc.
   Wymaga potwierdzenia w planie.
3. **Jak trwale naprawić CRLF: `.gitattributes` czy `endOfLine: "auto"`?**
   Pierwsze normalizuje repozytorium (jednorazowy duży diff, spójność między
   systemami), drugie jest zerokosztowe teraz, ale zostawia w repo mieszankę końców
   linii. Decyzja projektowa, nie techniczna — należy do planu.
4. **Czy `zod` domykamy w tej fazie?** Jednolinijkowa zmiana w `package.json`, ale
   formalnie poza „testami". Faza i tak bierze odpowiedzialność za bramkę build, więc
   research rekomenduje wchłonięcie — z jawną adnotacją w planie, tak jak przy długu
   lintowym.
5. **Czy asercja strukturalna na `generations` należy do tej fazy?** Chroni Guardrail 2
   (PRD:58), ale funkcja generacji jeszcze nie istnieje. Argument za: koszt bliski
   zeru, a regresja („dodajmy `source_text` do debugowania") jest realna i trudna do
   cofnięcia po fakcie. Argument przeciw: Ryzyko #2 w §2 przypisuje tę twarz temu
   rolloutowi, ale sam scenariusz obudzi się dopiero w S-01.
