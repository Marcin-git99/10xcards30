# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-02 (zmiana kolejności faz w §3)

## 1. Strategy

Testy w tym projekcie podlegają trzem nienegocjowalnym zasadom:

1. **Koszt × sygnał.** Wygrywa najtańszy test, który daje realny sygnał dla
   danego ryzyka. Nie promuj do e2e dlatego, że e2e „wydaje się
   bezpieczniejsze". Nie stawiaj modelu wizyjnego nad deterministycznym
   diffem, który i tak łapie regresję.
2. **Obawy użytkownika są pełnoprawnym dowodem.** Ryzyka zakotwiczone w
   „boję się X, a awaria ujawni się gdzieś w obszarze Y" ważą tyle samo, co
   linia z PRD czy dane o churnie.
3. **Ryzyka to scenariusze, nie lokalizacje w kodzie.** Ten plan dokumentuje
   _co może zawieść_ i _dlaczego uważamy to za prawdopodobne_ — na podstawie
   dokumentów, wywiadu i _sygnału_ z repozytorium (churn, struktura, stan
   testów). NIE twierdzi, że wie, która linia odpowiada za awarię. Tę wiedzę
   produkuje `/10x-research` w trakcie każdej fazy rolloutu. Jeśli plan i
   research nie zgadzają się co do tego, gdzie mieszka awaria, źródłem
   prawdy jest research.

Zakres hot-spot użyty do ważenia prawdopodobieństwa: `src/`, `supabase/migrations/`.

Uwaga o jakości tego sygnału: repozytorium ma 11 commitów z okna
2026-06-09..2026-06-13 i **zero commitów w ostatnich 30 dniach**. Guard
skilla („pomiń skan poniżej 5 commitów/30d") został świadomie obejściem
zastąpiony skanem pełnej historii — decyzja użytkownika. Maksymalny churn to
3 dotknięcia jednego pliku, więc churn traktujemy jako sygnał słaby i
pomocniczy. Główny ciężar prawdopodobieństwa niosą roadmapa (co jest
następne w kolejce) i wywiad.

## 2. Risk Map

Najważniejsze scenariusze awarii, przed którymi ten projekt musi się bronić,
uporządkowane wg ryzyka = wpływ × prawdopodobieństwo. Ryzyka są scenariuszami
awarii w kategoriach użytkownika i biznesu, nie nazwami testów. Kolumna
Źródło cytuje _dowód, który wyniósł to ryzyko na wierzch_ — nigdy konkretnego
pliku jako „miejsca awarii" (to zadanie researchu, patrz §1 zasada #3).

| #   | Ryzyko (scenariusz awarii)                                                                                                                                                                                                       | Wpływ  | Prawdop. | Źródło (dowód — nie kotwica)                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | User przechodzi przez zewnętrznego dostawcę logowania, ale nie wchodzi do aplikacji — wraca na stronę logowania w pętli, bez komunikatu błędu; albo wypada z sesji po odświeżeniu strony                                         | Wysoki | Wysoki   | wywiad Q1, Q2, Q3; roadmap F-02 status `ready` (następny w kolejce); `context/changes/google-oauth-switch/plan-brief.md` §Open Risks (zachowanie ciasteczek na runtime edge); hot-spot `src/pages/api` (6 dotknięć, pełna historia) |
| 2   | Wewnętrzne szczegóły systemu wyciekają na zewnątrz — surowy komunikat błędu bazy trafia do odpowiedzi API, sekret ląduje w bundlu front-endu, albo wklejony przez usera tekst źródłowy zostaje w miejscu dostępnym dla operatora | Wysoki | Wysoki   | `context/archive/2026-06-09-db-schema-mvp/reviews/impl-review.md` §F5 (potwierdzony wyciek, naprawiony — brak zabezpieczenia przed nawrotem); PRD §Success Criteria Guardrail 2; PRD §Non-Functional Requirements                   |
| 3   | Osoba bez ważnej sesji dosięga chronionego ekranu albo danych z API; albo odwrotnie — zalogowany user jest odbijany od własnych ekranów                                                                                          | Wysoki | Średni   | wywiad Q3; PRD US-02 §Acceptance Criteria; CLAUDE.md §Auth flow (lista tras chronionych w middleware); `context/changes/google-oauth-switch/plan-brief.md` §Key Decisions (nowe odbicie zalogowanych z tras auth)                   |
| 4   | Dane jednego usera są widoczne lub modyfikowalne przez innego usera                                                                                                                                                              | Wysoki | Średni   | PRD §Success Criteria Guardrail 3; PRD §Non-Functional Requirements; CLAUDE.md §Key conventions (RLS per-operation, per-role obowiązkowe); `context/archive/2026-06-09-db-schema-mvp/plan.md` (polityki RLS dla obu tabel)          |
| 5   | Po zatwierdzeniu paczki do biblioteki trafia inny zbiór kart niż ten, który user zatwierdził — usunięta karta wraca, edycja przepada, albo karty zapisują się mimo nieudanej generacji                                           | Wysoki | Średni   | PRD §Success Criteria Guardrail 1; PRD US-05 §Acceptance Criteria; PRD US-09 §Acceptance Criteria; PRD §Success Criteria Primary; roadmap S-01 §Risk                                                                                |
| 6   | Karta wraca do powtórki w złym terminie — ocena nie przesuwa jej zgodnie z drabiną interwałów, albo edycja treści karty resetuje jej harmonogram                                                                                 | Wysoki | Średni   | PRD FR-018, FR-019, FR-021, FR-026; roadmap S-02 §Risk („cicho niszczy wartość produktu"); roadmap S-03 §Risk („prosta reguła, łatwa do pominięcia")                                                                                |
| 7   | Trwałe usunięcie konta zostawia dane — osierocone rekordy generacji lub kart przeżywają usunięcie profilu                                                                                                                        | Wysoki | Średni   | PRD §Success Criteria Guardrail 4; PRD US-03 §Acceptance Criteria; roadmap S-04 §Risk (kaskada musi objąć tabelę generacji)                                                                                                         |

**Rubryka wpływ × prawdopodobieństwo.**

| Ocena  | Wpływ                                                                 | Prawdopodobieństwo                                            |
| ------ | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| Wysoki | user traci dostęp, dane albo pieniądze; awaria widoczna publicznie    | obszar zmienia się co tydzień, albo już się tu przejechaliśmy |
| Średni | funkcja działa gorzej, istnieje obejście, skutek odczuwa część userów | kod ruszany od czasu do czasu, bywał źródłem błędów           |
| Niski  | kosmetyka, łatwo cofnąć, brak skutku dla danych                       | kod stabilny, rzadko dotykany                                 |

Cztery guardraile z PRD mają pokrycie: Guardrail 1 → Ryzyko 5, Guardrail 2 →
Ryzyko 2, Guardrail 3 → Ryzyko 4, Guardrail 4 → Ryzyko 7. Oś nadużyć wchodzi
przez Ryzyko 3 (dostęp), Ryzyko 4 (własność zasobu / IDOR) i Ryzyko 2
(wyciek sekretów i danych wrażliwych).

**Świadomie poza mapą — nadużycie zasobów.** Masowe wywoływanie kosztownej
generacji (brak limitu, pętla ponowień) to realna klasa nadużycia, ale PRD
§Open Questions 5 pozostawia zachowanie przy powtarzających się
niepowodzeniach nierozstrzygnięte, a skala to dogfooding N=1. Ta klasa należy
dziś do limitów i obserwowalności, nie do scenariusza testowego. Patrz §7.

**Ryzyka 5, 6 i 7 dotyczą kodu, który nie istnieje jeszcze na gałęzi
głównej** (slice'y S-01, S-02/S-03, S-04 mają w roadmapie status `proposed`).
Ich fazy w §3 są zsekwencjonowane po odpowiednich slice'ach — uruchomienie
ich wcześniej zmusiłoby `/10x-research` do zmyślenia przedmiotu badania.

### Risk Response Guidance

| Ryzyko | Co dowodzi ochrony                                                                                                                                      | Co zakwestionować                                                                                                | Kontekst do ugruntowania przez `/10x-research`                                                                   | Prawdopodobnie najtańsza warstwa                                                | Antywzorzec do uniknięcia                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1      | Po pełnym przejściu ścieżki logowania user znajduje się na chronionym ekranie i **pozostaje na nim po odświeżeniu i po nawigacji**                      | „Przekierowanie 302 z endpointu oznacza, że logowanie działa" — w pętli powrotnej każdy krok z osobna zwraca 302 | kształt sesji i ciasteczka, granica runtime'u (edge vs node), miejsce wymiany kodu autoryzacyjnego na sesję      | integracyjny na złożonej ścieżce; e2e tylko jeśli sesji nie da się złożyć niżej | asercja na kod odpowiedzi zamiast na stan końcowy                                                            |
| 2      | Odpowiedź błędu widziana przez klienta **nie zawiera** nazw kolumn, constraintów ani treści źródłowej; artefakt builda nie zawiera sekretu              | „Błąd jest obsłużony, więc jest bezpiecznie" — obsłużony nie znaczy zredagowany                                  | granica tłumaczenia błędów, co trafia do logu a co do odpowiedzi, co jest inline'owane do klienta                | integracyjny na ścieżkach błędu plus kontrola artefaktu builda                  | test wyłącznie ścieżki udanej; asercja skopiowana z aktualnej treści komunikatu                              |
| 3      | Żądanie bez ważnej sesji **nie otrzymuje** treści chronionej — ani strony, ani danych z API                                                             | „Middleware chroni stronę, więc API też jest chronione" — to dwie różne bramki                                   | lista tras chronionych, gdzie kończy się bramka strony a zaczyna bramka API, kształt odpowiedzi przy braku sesji | integracyjny na trasach                                                         | testowanie wyłącznie ścieżki zalogowanej                                                                     |
| 4      | Żądanie usera A o zasób usera B **nie zwraca danych i ich nie modyfikuje**, również przy ręcznej podmianie identyfikatora                               | „Zalogowany znaczy uprawniony"; „RLS jest włączone, więc działa"                                                 | gdzie faktycznie egzekwowana jest własność (baza czy kod), jak zestawić dwie tożsamości w jednym teście          | integracyjny z dwiema tożsamościami przeciw realnej bazie                       | test z jednym userem; mockowanie tej warstwy, która ma egzekwować regułę                                     |
| 5      | Zbiór kart w bibliotece **równa się dokładnie** temu, co user zatwierdził; po nieudanej generacji biblioteka pozostaje niezmieniona                     | „Zwróciliśmy 200, więc zapis jest poprawny"; „weszło 5 kart, więc OK"                                            | moment persystencji, powiązanie paczki z aktem generacji, zachowanie przy błędzie w połowie zapisu               | integracyjny na akcie zatwierdzenia                                             | asercja na liczbę kart zamiast na ich tożsamość; brak przypadku odrzucenia karty                             |
| 6      | Karta po ocenie ma termin **zgodny z drabiną opisaną w wymaganiach** (interwały i górne ograniczenie z FR-021); edycja treści karty terminu nie zmienia | „Test przechodzi, bo tyle zwraca funkcja" — **wyrocznia musi pochodzić z FR-021, nie z implementacji**           | źródło prawdy o interwałach, sposób liczenia terminu, warunek wykluczenia karty z kolejki                        | jednostkowy na regule harmonogramu plus integracyjny na edycji                  | lustro implementacji; pominięcie granic (górne ograniczenie, reset po negatywnej ocenie, karta niekompletna) |
| 7      | Po usunięciu konta **żadnym torem** nie da się dosięgnąć danych usera; ponowne wejście tą samą tożsamością daje puste konto                             | „Profil zniknął, więc reszta też" — kaskada bywa niepełna                                                        | co kaskaduje w schemacie a co w kodzie, kolejność usuwania rekordów podrzędnych                                  | integracyjny przeciw realnej bazie                                              | asercja wyłącznie na profil; brak sprawdzenia rekordów podrzędnych                                           |

## 3. Phased Rollout

Każdy wiersz to odrębna faza rolloutu, która otworzy własny folder zmiany
przez `/10x-new`. Status przesuwa się od lewej do prawej; orchestrator
aktualizuje go w miarę pojawiania się artefaktów na dysku.

| #   | Phase name                               | Goal (one line)                                                                                                                                     | Risks covered | Test types         | Status      | Change folder                             |
| --- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------ | ----------- | ----------------------------------------- |
| 1   | Runner + izolacja danych i brak wycieków | Postawić runner i ożywić martwe bramki; udowodnić, że dane usera A są nieosiągalne dla usera B, a odpowiedzi błędu nie wypisują wnętrzności systemu | #2, #4        | integration, gates | complete    | `context/changes/testing-data-isolation/` |
| 2   | Bramka wejścia                           | Udowodnić, że user faktycznie wchodzi do aplikacji i w niej zostaje, a osoba bez sesji nie wchodzi                                                  | #1, #3        | integration        | not started | —                                         |
| 3   | Kuratela paczki                          | Udowodnić, że biblioteka zawiera dokładnie to, co user zatwierdził — nic więcej i nic mniej                                                         | #5            | integration        | not started | —                                         |
| 4   | Poprawność harmonogramu                  | Udowodnić, że drabina powtórek zachowuje się zgodnie z wymaganiami, a edycja treści karty jej nie rusza                                             | #6            | unit, integration  | not started | —                                         |
| 5   | Kaskada usunięcia konta                  | Udowodnić, że trwałe usunięcie konta nie zostawia żadnych danych                                                                                    | #7            | integration        | not started | —                                         |

**Status vocabulary** (stałe literały parsera): `not started` → `change opened`
→ `researched` → `planned` → `implementing` → `complete`.

Uzasadnienie kolejności. Faza 1 idzie pierwsza, bo jako jedyna nie jest
zablokowana niczym: dotyczy kodu API kart i migracji obecnych dziś na gałęzi
głównej, których nie modyfikuje żaden otwarty Pull Request. Pokrywa też
Ryzyko 2 — jedyne z potwierdzonym precedensem w archiwum. Ponieważ rusza
pierwsza, to ona stawia runner i ożywia bramki; bez tego żadna kolejna faza
nie ma na czym stanąć. Faza 2 czeka na wylądowanie F-02 na gałęzi głównej,
bo przepisuje on tę samą ścieżkę logowania, której faza ma bronić — testy
pisane wcześniej celowałyby w kod przeznaczony do usunięcia. Fazy 3, 4 i 5
czekają na swoje slice'y (odpowiednio S-01, S-02 z S-03, S-04).

**Zmiana kolejności (2026-08-02).** Pierwotnie faza „Bramka wejścia" była
pierwsza, zgodnie z wagą Ryzyka 1 (Wysoki × Wysoki z wywiadu). Zamieniona z
fazą izolacji danych po ustaleniu, że wymaga wcześniejszego domknięcia F-02,
a to z kolei wymaga ręcznej konfiguracji dostawcy logowania poza
repozytorium. Priorytet Ryzyka 1 w §2 pozostaje bez zmian — zmieniła się
kolejność dostawy, nie ocena ryzyka.

## 4. Stack

Klasyczna baza testowa dla tego projektu. Rekomendacje ugruntowane w lokalnym
manifeście i w dokumentacji dostępnej przez MCP w bieżącej sesji.

| Warstwa                 | Narzędzie                                     | Wersja                  | Uwagi                                                                                                                                                                                                                                                |
| ----------------------- | --------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration      | Vitest                                        | do przypięcia w Phase 1 | integracja przez `getViteConfig()` z `astro/config`; **Astro 6 wymaga `environment: 'node'`** — renderowanie komponentów `.astro` w środowiskach klienckich Vitest nie jest już dozwolone                                                            |
| komponenty `.astro`     | Container API (Astro)                         | eksperymentalne         | dostępne, ale poza zakresem tego rolloutu — §7 wyklucza testowanie warstwy prezentacji                                                                                                                                                               |
| API mocking             | brak — patrz Phase 2                          | —                       | polityka do ustalenia w researchu Phase 2; domyślnie mockować wyłącznie na granicy sieci, nigdy modułów wewnętrznych                                                                                                                                 |
| e2e                     | kandydat, decyzja w Phase 1                   | —                       | uzasadnione tylko jeśli sesji z Ryzyka 1 nie da się złożyć na warstwie integracyjnej; logowanie przez zewnętrznego dostawcę jest kosztowne do zautomatyzowania                                                                                       |
| accessibility           | brak — poza zakresem MVP                      | —                       | PRD §Open Questions 3 nie ustala poziomu dostępności                                                                                                                                                                                                 |
| (opcjonalnie) AI-native | Claude Browser (in-app) — checked: 2026-08-02 | n/a                     | **Kiedy NIE używać:** gdy awaria jest wykrywalna deterministycznym testem integracyjnym. Warstwa uzasadniona wyłącznie do ręcznej weryfikacji złożonej ścieżki logowania na wdrożonym środowisku, gdy runtime edge zachowuje się inaczej niż lokalny |

**Stack grounding tools (current session):**

- Docs: Context7 — sprawdzono setup Vitest dla Astro (`getViteConfig()`) oraz zmianę w Astro 6 wymuszającą `environment: 'node'` dla komponentów `.astro`; checked: 2026-08-02
- Search: WebSearch/WebFetch dostępne — nieużyte, dokumentacja pierwotna wystarczyła; checked: 2026-08-02
- Runtime/browser: Claude Browser (in-app) — możliwa warstwa ręcznej weryfikacji wdrożonego środowiska; checked: 2026-08-02
- Provider/platform: brak — GitHub, Supabase ani Cloudflare MCP nie są dostępne w tej sesji; weryfikacja stanu wdrożenia i logów pozostaje ręczna; checked: 2026-08-02

Stan wyjściowy bazy testowej: **brak**. Zero konfiguracji runnera, zero plików
testowych.

## 5. Quality Gates

Pełny zestaw bramek, które muszą przejść, zanim zmiana trafi na produkcję.
„Wymagana po §3 Phase N" oznacza, że bramka zaczyna obowiązywać po
wylądowaniu tej fazy rolloutu; wcześniej ma status planowanej.

| Bramka                               | Gdzie                    | Wymagana?                                | Co łapie                                             |
| ------------------------------------ | ------------------------ | ---------------------------------------- | ---------------------------------------------------- |
| typecheck (`astro check`)            | lokalnie                 | wymagana                                 | dryf typów                                           |
| lint                                 | lokalnie + CI            | wymagana (od §3 Phase 1)                 | dryf składniowy i stylistyczny                       |
| build                                | CI                       | wymagana (od §3 Phase 1)                 | błędy kompilacji i konfiguracji                      |
| testy hermetyczne (`test:hermetic`)  | lokalnie + CI            | wymagana (od §3 Phase 1)                 | regresje logiki niewymagające bazy, wyciek sekretu   |
| testy integracyjne (`test:integration`) | lokalnie, ad hoc      | wymagana przed merge (poza CI)           | regresje reguł bazy — RLS, constrainty, schemat      |
| pre-commit (husky + lint-staged)     | lokalnie                 | wymagana                                 | formatowanie i podstawowy lint na plikach w commicie |
| ręczny smoke na wdrożonym środowisku | między merge a produkcją | zalecana                                 | awarie specyficzne dla runtime'u edge (Ryzyko 1)     |

Dwa fakty, które Phase 1 musiała naprawić, zanim ta tabela zaczęła cokolwiek
znaczyć — **oba naprawione 2026-08-06**:

1. ~~**Workflow CI wyzwala się na gałęzi, która w tym repozytorium nie
   istnieje.**~~ Trigger przestawiony `master` → `main` (`515c76d`). Przy
   okazji wyszło, że repozytorium **nie miało ustawionych sekretów**
   `SUPABASE_URL`/`SUPABASE_KEY` — czyli nawet z poprawnym triggerem build
   by nie przeszedł. Sekrety ustawione przez właściciela repo.
2. ~~**`npm run lint` failuje w całym repozytorium.**~~ Naprawione
   (`c552e38` + `ba1a0e6`): `.gitattributes` z `eol=lf` plus dziewięć realnych
   naruszeń reguł. Uwaga na przyszłość: z tych 1050 błędów **1039 to były CRLF
   widoczne wyłącznie na Windows** — na runnerze CI dług wynosił dziewięć
   błędów, nie 1050. Zmiana `context/changes/lint-debt-cleanup/` zamknięta
   jako wchłonięta przez `testing-data-isolation`.

## 6. Cookbook Patterns

Jak dodawać nowe testy w tym projekcie. Każda podsekcja zostaje wypełniona,
gdy odpowiednia faza rolloutu wyląduje; wcześniej zawiera odsyłacz do fazy.

### 6.1 Dodanie testu integracyjnego ścieżki logowania i dostępu

TBD — patrz §3 Phase 2. Wzorzec ma pokrywać scenariusz „user przechodzi
logowanie i pozostaje w aplikacji po odświeżeniu" (Ryzyko 1) oraz „żądanie
bez sesji nie otrzymuje treści chronionej" (Ryzyko 3).

### 6.2 Dodanie testu izolacji danych między userami

Wzorzec: `test/integration/cards-isolation.test.ts`. Fixture:
`test/helpers/identities.ts`.

**Dwie tożsamości.** `createIdentity("etykieta")` zakłada konto przez zwykłe
`signUp()` i zwraca uwierzytelnionego klienta. Działa bez klucza serwisowego,
bo `supabase/config.toml` ma `[auth.email] enable_confirmations = false`.
**Nie sięgaj po klucz serwisowy** — omija RLS, czyli dokładnie tę warstwę,
której test ma bronić. Klienty mają `persistSession: false`, żeby sesje nie
wyciekały między plikami.

**Odmowa RLS jest cicha.** PostgREST zwraca `HTTP 200`, `error: null` i zero
wierszy — nie 403 i nie wyjątek. Test napisany jako „oczekuj błędu"
**przeszedłby także na bazie bez RLS**, gdyby danych po prostu nie było.
Jedyny wyjątek: INSERT z cudzym `user_id` daje twarde `42501`.

**Asercja idzie na stan po operacji, nie na wynik operacji.** Pusty wynik
`update()` niczego nie dowodzi — bez `.select()` PostgREST nie zwraca wierszy
nawet przy udanym zapisie. Odczytaj zasób **klientem właściciela** i sprawdź,
że jest nietknięty:

```ts
await bob.client.from("cards").update({ question: "PWNED" }).eq("id", aliceCardId);
const { data } = await alice.client.from("cards").select().eq("id", aliceCardId).maybeSingle<Card>();
expect(data?.question).toBe("Pytanie Alice");
```

**Zawsze zweryfikuj mutacją.** Test izolacji, który przechodzi też przy
złamanej izolacji, jest gorszy niż jego brak. Właściwa mutacja to
**osłabienie** polityki, nie jej usunięcie:

```bash
docker exec supabase_db_<projekt> psql -U postgres -c \
  'alter policy "users can select their own cards" on cards using (true);'
```

Usunięcie polityki (`drop policy`) czyni bazę **bardziej** restrykcyjną —
default-deny blokuje wszystkich i testy słusznie przechodzą. Przywracasz
przez `alter policy ... using (user_id = auth.uid())` albo `supabase db reset`.

**Polityka SELECT chroni także UPDATE i DELETE.** PostgreSQL stosuje ją do
`UPDATE ... WHERE`, bo zapytanie musi najpierw odczytać wiersz. Osłabienie
samego UPDATE nie złamie testu — potrzeba SELECT + UPDATE razem. Przy
projektowaniu nowych polityk traktuj SELECT jako warstwę nośną.

### 6.3 Dodanie testu na ścieżkę błędu API

Wzorzec: `test/hermetic/cards-error-redaction.test.ts`.

**Wybór warstwy.** Zanim napiszesz test integracyjny, sprawdź, czy gałąź błędu
jest w ogóle osiągalna przez HTTP. W `POST /api/cards` nie jest: `z.object`
bez `.strict()` usuwa nieznane pola, więc klient nie ma jak naruszyć CHECK-a.
Taka ścieżka należy do testu **hermetycznego** — inaczej wymuszasz stan,
którego produkcja nie osiąga.

**Stubuj granicę, nie moduł pod testem.** Podmieniamy klienta Supabase
(`vi.mock("@/lib/supabase")`), a endpoint wykonuje swoją realną ścieżkę błędu.
Karm stub kształtem zdjętym z żywej bazy, nie wymyślonym:

```ts
const REAL_DB_ERROR = {
  code: "23514",
  message: 'new row for relation "cards" violates check constraint "cards_source_check"',
  details: null, hint: null,
};
```

**Asercja negatywna na listę ciągów**, nie porównanie z treścią komunikatu.
Skopiowanie oczekiwanej wartości z implementacji daje test-lustro, który
przechodzi także po regresji:

```ts
for (const leak of ["cards", "constraint", "violates", "23514", "relation"]) {
  expect(body.toLowerCase()).not.toContain(leak);
}
```

**Redakcja ma dwie połowy.** Szczegóły mają zniknąć z odpowiedzi, ale trafić
do logu serwera. Bez asercji na `console.error` „poprawka" polegająca na cichym
połknięciu błędu też przeszłaby test — i zabiłaby diagnostykę produkcyjną.

**Sprawdź kontrakt dla klienta.** Pole `error` musi być stringiem; obiekt
renderowany jako React child wysypuje wyspę (precedens: §F2 w
`context/archive/2026-06-09-db-schema-mvp/reviews/impl-review.md`).

### 6.4 Dodanie testu jednostkowego reguły biznesowej

TBD — patrz §3 Phase 4. Wzorzec ma pokrywać regułę harmonogramu powtórek
(Ryzyko 6), z naciskiem na to, że oczekiwane wartości pochodzą z wymagań, a
nie z testowanej implementacji.

### 6.5 Dodanie testu dla nowego endpointu API

**Domyślna warstwa** wynika z tego, czego wymaga uruchomienie, nie z etykiety:

| Co sprawdzasz | Katalog | Wymaga |
|---|---|---|
| reguły bazy, kaskady, constrainty | `test/integration/` | działającego Supabase |
| gałęzie błędu nieosiągalne przez HTTP, artefakt builda | `test/hermetic/` | tylko `dist/` |

`npm run test:hermetic` idzie na CI, `npm run test:integration` zostaje bramką
ad hoc (§4). Ten podział jest też podziałem w `.github/workflows/ci.yml`.

**Polityka mockowania: tylko granica sieci, nigdy moduł wewnętrzny.**
Mockowanie warstwy, która egzekwuje testowaną regułę, unieważnia test.

**Asercja na skutek uboczny, nie na kształt odpowiedzi.** `201` z poprawnym
JSON-em nie dowodzi, że wiersz powstał, ma właściwego właściciela i nie
nadpisał cudzego. Po każdym zapisie odczytaj stan i sprawdź go osobno.

**Wywoływanie endpointu w teście.** Import modułu route'u i wywołanie
`POST(context)` z ręcznie złożonym `APIContext` — patrz
`test/hermetic/cards-error-redaction.test.ts`. Minimalny kontekst to `locals`,
`request` i `cookies`; reszty Astro nie wymaga.

**Guard środowiskowy działa dla każdego testu.** `test/setup.ts` ubija cały
przebieg, jeśli `SUPABASE_URL` widziany przez `astro:env/server` nie wskazuje
localhosta. Nie omijaj go — testy integracyjne zakładają konta i piszą wiersze.

### 6.6 Notatki z poszczególnych faz rolloutu

**Phase 1 — Runner + izolacja danych i brak wycieków (2026-08-05/06).**

Pułapki środowiskowe, które kosztowały najwięcej czasu:

- **`[vite] server restarted` nie przeładowuje `process.env`.** Adapter
  Cloudflare wstrzykuje tam wartości z `.dev.vars` przy starcie procesu.
  Po zmianie `.env`/`.dev.vars` **ubij proces**, nie licz na restart Vite.
  Objaw: aplikacja pisze do produkcji, mimo że oba pliki wskazują localhost.
- **Fragmenty ciasteczek z dwóch projektów Supabase unieważniają się
  nawzajem.** Supabase tnie token na kilka ciasteczek; mieszanka ze starego
  i nowego projektu daje „zalogowany na `/`, odbity z `/dashboard`". Przy
  przełączaniu środowisk używaj okna incognito.
- **`supabase db reset` zostawia Kong z nieświeżym wpisem auth** — objaw to
  `502` na `/auth/v1/*` mimo zdrowego kontenera. Lekarstwo:
  `docker restart supabase_kong_<projekt>`.
- **`astro:env/server` w Vitest czyta `.env.test`** (sprawdzone
  eksperymentalnie), ale `process.env` wygrywa z plikiem — zabłąkana zmienna
  w powłoce przekieruje testy. Dlatego guard czyta wartość efektywną, a nie
  zawartość pliku.
- **Adapter Cloudflare jest wyłączony pod Vitest** (`process.env.VITEST`
  w `astro.config.mjs`), bo jego plugin Vite odrzuca `resolve.external`
  ustawiane przez Vitest dla środowiska SSR.
- **Dług CRLF był widoczny tylko na Windows.** `core.autocrlf=true`
  normalizuje przy commicie, więc repozytorium od zawsze trzymało LF —
  na Linuksie tych 1039 błędów nigdy nie było. `.gitattributes` z `eol=lf`
  wyrównuje drzewo robocze.
- **Bramka artefaktu celuje w `dist/client/**`, nie w `dist/`.** Sekret
  legalnie siedzi w `dist/server/.dev.vars`, który nie jest publikowany
  (adapter nadpisuje `assets.directory` na `../client`).

## 7. What We Deliberately Don't Test

Wykluczenia uzgodnione podczas wywiadu (Phase 2). Kolejne osoby pracujące w
tym repozytorium powinny ich przestrzegać, dopóki nie zmieni się leżące u
podstaw założenie.

- **Wygląd strony wejściowej i testy snapshotowe interfejsu** — psują się
  przy każdej zmianie i nic nie łapią. Przemyśleć ponownie, jeśli wygląd
  stanie się elementem oferty produktu. (Źródło: wywiad Q5.)
- **Jakość merytoryczna treści generowanych przez model językowy** — wynik
  jest niedeterministyczny, więc asercja na treść dałaby fałszywy sygnał.
  Chronimy kontrakt paczki (liczba, kompletność, kuratela), nie jej treść.
  Przemyśleć ponownie, jeśli pojawi się miara jakości inna niż ocena
  człowieka. (Źródło: propozycja agenta, zatwierdzona przez usera.)
- **Komponenty biblioteki interfejsu (`shadcn/ui`)** — kod zewnętrzny,
  testowany u źródła. Przemyśleć ponownie, jeśli komponent zostanie mocno
  zmodyfikowany lokalnie. (Źródło: propozycja agenta, zatwierdzona przez
  usera.)
- **Limitowanie i koszt generacji** — realna klasa nadużycia, ale zachowanie
  przy powtarzających się niepowodzeniach jest nierozstrzygnięte (PRD §Open
  Questions 5), a skala to pojedynczy user. Należy dziś do limitów i
  obserwowalności, nie do testu. Przemyśleć ponownie, gdy produkt wyjdzie
  poza dogfooding albo gdy PRD rozstrzygnie tę kwestię. (Źródło: oś nadużyć,
  świadomie zaparkowane.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-02
- Stack versions last verified: 2026-08-02
- AI-native tool references last verified: 2026-08-02

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
