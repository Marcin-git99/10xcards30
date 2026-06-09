---
project: 10xCards
context_type: greenfield
created: 2026-05-23
updated: 2026-05-24
product_type: web_app
tech_preferences:
  language_family: typescript
checkpoint:
  current_phase: complete
  phases_completed: [1, 2, 3, 4, 5, 6]
  frs_drafted: 28
  quality_check_status: passed_with_override (MVP-too-big AMBER → Override-1 + Cut-4; Cut-1 reverted 2026-05-24 — FR-028 manual card creation added, ~+0.8 dev-day)
---

# 10xCards — Shape Notes

## Seed idea (verbatim from user)

### Główny problem
Manualne tworzenie wysokiej jakości fiszek edukacyjnych jest czasochłonne, co zniechęca do korzystania z efektywnej metody nauki jaką jest spaced repetition.

### Najmniejszy zestaw funkcjonalności
- Generowanie fiszek przez AI na podstawie wprowadzonego tekstu (kopiuj-wklej)
- Manualne tworzenie fiszek
- Przeglądanie, edycja i usuwanie fiszek
- Prosty system kont użytkowników do przechowywania fiszek
- Integracja fiszek z gotowym algorytmem powtórek

### Co NIE wchodzi w zakres MVP
- Własny, zaawansowany algorytm powtórek (jak SuperMemo, Anki)
- Import wielu formatów (PDF, DOCX, itp.)
- Współdzielenie zestawów fiszek między użytkownikami
- Integracje z innymi platformami edukacyjnymi
- Aplikacje mobilne (na początek tylko web)

### Kryteria sukcesu
- 75% fiszek wygenerowanych przez AI jest akceptowane przez użytkownika
- Użytkownicy tworzą 75% fiszek z wykorzystaniem AI

## Vision & Problem Statement

**Pain.** Tworzenie wysokiej jakości fiszek edukacyjnych jest pracą *kognitywną*, nie mechaniczną. Składa się z trzech odrębnych aktów:
1. **Editorial** — wybór z materiału, co jest warte zafiszkowania.
2. **Question crafting** — sformułowanie jednoznacznego pytania.
3. **Answer crafting** — zbudowanie zwięzłej, treściwej odpowiedzi.

Wszystkie trzy konsumują tę samą energię intelektualną, która powinna iść w naukę. Dlatego użytkownicy rezygnują ze spaced repetition mimo wiedzy o jego skuteczności.

**Moment.** Użytkownik styka się z bólem w momencie *pierwszego zapoznania z materiałem* — czyta nowy rozdział / dokumentację / artykuł i wie, że powinien zrobić z tego fiszki, ale nie ma siły na 45 minut przepisywania po przeczytaniu.

**Cost today (bezpośredni).** 2–3× więcej czasu spędzanego na tworzeniu fiszek zamiast na nauce. Utrata energii intelektualnej. Frustracja i zmęczenie.

**Cost today (pośredni).** Szybsze zapominanie materiału. Oblane egzaminy. Wolniejsze przyswajanie nowej wiedzy w pracy zawodowej.

**Wedge — co wiemy, czego status quo nie wie.** Istnieje silny LLM. Istnieje sprawdzony algorytm SRS (SuperMemo, Anki). Ale **nikt nie połączył ich w jednym workflow**. Dzisiaj user musi żonglować ChatGPT + ręczny import do Anki / Quizlet — friction tego workflow zabija nawyk. Wartość 10xCards leży w **integracji**, nie w wymyślaniu nowego AI ani nowego SRS.

## User & Persona

**Primary persona — Programista uczący się nowego stacka.**

Programista (junior lub senior) wchodzący w nową technologię: framework, język, bibliotekę, paradygmat, ekosystem. Czyta oficjalną dokumentację, książki techniczne, artykuły, kod source'owy. Wie, że spaced repetition byłoby idealne do utrwalania API, konceptów, idiomów — ale dzisiaj rezygnuje, bo koszt tworzenia fiszek przewyższa percepcyjny zysk.

**Kontekst użycia.** Tryb (a) — pierwsze zapoznanie z materiałem. Sesje krótkie do średnich (15–45 min), inicjowane bezpośrednio po przeczytaniu fragmentu. Oczekuje od AI **długich, kontekstowych odpowiedzi**, które pomagają zbudować rozumienie (nie tylko zapamiętać fakt).

**Cel persony.** Trwałe rozumienie nowego stacka w tempie pracy zawodowej, bez wypalenia.

**Bonus property.** Persona jest blisko właściciela produktu (dogfooding) — pętla feedbacku jest krótka, walidacja N=1 jest dostępna od dnia 1.

### Secondary personas (poza zakresem MVP, kandydaci do v2)

Studenci kierunków o wysokiej gęstości materiału (medycyna, prawo, ekonomia) — najmocniejszy ból, ostry deadline sesji egzaminacyjnej. Prawnicy w aplikacji. Poligloci. Wszyscy "utrwalający wiedzę". → patrz `## Open Questions` / v2.

### Mode discipline (decyzja MVP)

MVP obsługuje **tylko tryb (a)** — pierwsze zapoznanie, odpowiedzi długie i kontekstowe. Tryb (b) — sesja powtórkowa / awaryjna z krótkimi odpowiedziami — świadomie odłożony do v2. Powód: jeden AI prompt, jeden UX, ostra value prop dla MVP.

## Access Control

**Model auth.** Google OAuth jako jedyny sposób logowania w MVP. Brak email+hasło, brak innych providerów (GitHub, Apple, Microsoft itd.) w MVP. Powód: zero-friction onboarding (1 klik, brak "klikologii z potwierdzaniem maila"), wycięcie z MVP całego flow password-management, dopasowanie do persony (programista — Google account praktycznie pewny), dogfooding pętla bez tarcia od dnia 1. Email+hasło świadomie odłożone do v2 na wypadek pojawienia się persony poza-dev.

**Wymagane funkcje auth w MVP:**
- Logowanie przez Google OAuth (utworzenie sesji + cookie)
- Wylogowanie — standardowy endpoint czyszczący sesję/cookie
- Usunięcie konta — przycisk "Usuń konto" wykonujący kaskadowe skasowanie profilu użytkownika i wszystkich jego fiszek z bazy

**Model ról.** Flat — 1 user = 1 zestaw fiszek. Brak ról (brak admin, brak viewer, brak shared decks). Każdy user widzi i zarządza wyłącznie własnymi fiszkami. Współdzielenie zestawów świadomie poza zakresem MVP (zgodnie z seedem).

**Świadomie wycięte ze scope'u MVP** (konsekwencja OAuth-only — te pozycje były wcześniej Open Questions, teraz są zamknięte przez wybór providera):
- Rejestracja email+hasło i hashowanie haseł
- Reset hasła
- Weryfikacja emaila (Google poświadcza tożsamość)
- Polityka długości / siły hasła

**Open Questions (nowe, otwarte):**
- v2: czy dodać drugiego providera (GitHub byłby najbardziej naturalny dla persony "programista")?
- v2: czy dodać email+hasło, gdy/jeśli pojawi się persona poza-dev?
- GDPR: czy "Usuń konto" wystarczy (art. 17 — right to be forgotten), czy potrzebny też **eksport danych** użytkownika (art. 20 — right to data portability)? W MVP zakładamy: nie. Decyzja do potwierdzenia.

## MVP Scope

### First flow (golden path, verbatim ze scenariusza usera)

1. Programista loguje się przez Google OAuth (pomija "klikologię z potwierdzaniem maila").
2. Ląduje na ekranie głównym z polem tekstowym: *"Wklej kod lub dokumentację, z której chcesz się pouczyć"*.
3. Wkleja fragment dokumentacji (np. o React Server Components) i klika **[Generuj fiszki z AI]**.
4. Widzi loader (target p95 < 10s, hard cutoff 30s z friendly error), aplikacja renderuje listę **5 wygenerowanych pytań i odpowiedzi (Q&A)**.
5. Przegląda: 4 ok, jedną edytuje bezpośrednio w polu tekstowym (Q lub A), żeby doprecyzować.
6. Klika **[Zatwierdź i przejdź do nauki]**.
7. Uruchamia się sesja SRS — widzi pierwszą fiszkę (pytanie), klika **"Pokaż odpowiedź"**.
8. Ocenia wiedzę binarnie: **[Wiem / Nie wiem]** — Leitner-light kolejkuje powtórkę.
9. Po przeklikaniu 5 fiszek widzi podsumowanie: *"Dobra robota! Pierwsza powtórka jutro o ~10:00"*.
10. Zamyka kartę z poczuciem: *"W 2 minuty zamieniłem suchy tekst w aktywną naukę, wracam jutro"*.

### W zakresie MVP (IN)

| # | Komponent | Źródło decyzji |
|---|---|---|
| 1 | Logowanie / wylogowanie / usuwanie konta z kaskadą | Faza 2 |
| 2 | AI generation z wklejonego tekstu — **sztywno 5 fiszek** na paczkę | D2 |
| 3 | Loader generacji — **NFR: p95 < 10s, hard cutoff 30s** z friendly error i retry | D1 |
| 4 | UI przeglądu paczki — edycja Q i A inline, usunięcie pojedynczej fiszki z paczki (X), [Zatwierdź i przejdź do nauki]. **Brak dodawania nowych fiszek w tym widoku.** | D3 |
| 5 | Sesja SRS — pokaż pytanie → "Pokaż odpowiedź" → **[Wiem / Nie wiem]** | scenariusz |
| 6 | Algorytm: **Leitner-light, 5 pudełek, interwały [1, 3, 7, 14, 30 dni]**. Wiem → następne pudełko (max 5). Nie wiem → pudełko 1 (reset). | D5a |
| 7 | Model sesji: **T4 Hybrid** — backend liczy `next_review_at` per fiszka; UI copy "jutro o ~10:00" jako friendly default | D5c |
| 8 | Ekran "Moje fiszki" — lista wszystkich fiszek usera (AI + manualnych), edycja Q i A, usunięcie pojedynczej fiszki, **[+ Nowa fiszka]** dla manualnego utworzenia pustej fiszki (FR-028) | pyt. zerowe (B) + 2026-05-24 |
| 9 | Ekran podsumowania sesji — "Pierwsza powtórka jutro o ~10:00" | scenariusz pkt 9 |

### Poza zakresem MVP (OUT, świadomie)

- Decki / zestawy / topic-i — flat pool w MVP (D4a = A1)
- Dodawanie fiszek w widoku review-after-generation (tylko edit/delete istniejących w paczce)
- Konfigurowalna godzina sesji w UI settings — copy "10:00" hardcoded
- Adaptive liczba fiszek per generacja (sztywno 5)
- Bogatsze ratingi (Hard/Good/Easy) i algorytmy SM-2/FSRS
- Notyfikacje push / email reminders o sesji
- Multiple AI providers / model selection / temperature tuning UI
- Aplikacje mobilne (web-only w MVP)
- Sharing decks / multi-user collaboration
- Import PDF/DOCX/innych formatów (kopia-wklej only)
- Email+hasło, GitHub OAuth (Faza 2)
- Eksport danych usera (GDPR art. 20)
- **CI/CD pipelines** — deploy ręczny w MVP (Cut-4 anti-pattern check)
- Settings UI w MVP

### Data model (z D4)

```
User ──< Generation ──< Card { source: 'ai' | 'manual', generation_id: nullable FK }
```

- **User**: PK, dane z Google OAuth (email, google_sub, display_name, created_at)
- **Generation**: PK, FK → User, `source_text_hash`, `created_at`. Reprezentuje jedną paczkę 5 fiszek wygenerowanych z konkretnego wkleju
- **Card**: PK, FK → User, FK nullable → Generation, `question`, `answer`, `source` enum ('ai' | 'manual'), `leitner_box` (1–5), `next_review_at`, `created_at`, `updated_at`
- `source` field rozróżnia AI-generowane fiszki (`'ai'`) od manualnie utworzonych przez usera na ekranie "Moje fiszki" (`'manual'`, FR-028)
- `generation_id` nullable: NOT NULL dla `source='ai'` (link do paczki), NULL dla `source='manual'`

### Decyzje granularne (D1–D5)

| ID | Decyzja | Wynik |
|---|---|---|
| D1 | Loader timeout policy | Target p95 < 10s (NFR), hard cutoff 30s + friendly error + przycisk retry |
| D2 | Cards per generation | Sztywno 5, nie konfigurowalne, brak adaptive |
| D3 | Edytowalność post-generacji (przed [Zatwierdź]) | Edycja Q i A (2 pola tekstowe), usunięcie fiszki (X), brak dodawania nowych |
| D4a | Decks/zestawy w MVP | Flat pool (A1) |
| D4b | Rozróżnienie source AI vs manual w bazie | Tak, pole `source` (B1) |
| D4c | Linkowanie fiszka → generation batch | Tak, opcjonalny `generation_id` (C1) |
| D5a | Algorytm SRS | Leitner-light, 5 pudełek, [1, 3, 7, 14, 30 dni] |
| D5b | Mapping binary → grade | N/A (Leitner jest binary-native) |
| D5c | Model sesji "jutro o 10:00" | T4 Hybrid — interwał per fiszka, copy hardcoded "~10:00" jako friendly default |

### Anti-pattern checks

- **Empty-CRUD: 🟢 GREEN.** Dwa rule-engines: (1) generacja AI (synthesis rule: tekst → strukturyzowane Q&A), (2) Leitner-light (workflow rule: rating → box ladder → interwał).
- **MVP-too-big: 🟡 AMBER, świadomy override przez usera.** Estymata ~9,5 dev-days FTE ≈ ~3,5–4 tyg. after-hours (po Cut-1 i Cut-4). Override powód: dogfooding od dnia 1, silna motywacja, "Moje fiszki" CRUD potrzebne do data control + UX, akceptowalne okno motywacji.
  - **Cut-1 zastosowane (cofnięte 2026-05-24)**: manualne tworzenie fiszek OUT z MVP → przywrócone jako FR-028 (manualna pusta fiszka z ekranu "Moje fiszki"). Powód cofnięcia: incremental ~0.8 dev-day, Secondary Success Criterion staje się mierzalny, BR-7 absorbuje "draft exclusion" jednym predykatem (nie wymaga zmiany schemy)
  - **Cut-4 zastosowane**: brak CI/CD setup w MVP, pierwsze wdrożenie ręcznie, automatyzacja po premierze
  - **Override-1 zastosowane**: "Moje fiszki" CRUD zostaje w scope mimo soft target

### Open Questions z Fazy 3

- **Kryterium sukcesu nr 2** ("75% fiszek tworzonych przez AI") — **RESOLVED 2026-05-24**: po dodaniu FR-028 kryterium staje się mierzalne w MVP jako stosunek liczby fiszek z `source='ai'` do całkowitej liczby fiszek per user. Pierwsze kryterium ("75% AI-generated akceptowanych") **JEST** mierzalne w MVP jako acceptance rate: (zatwierdzone / wygenerowane) per paczka, agregowane per user.
- Czy `Generation.source_text_hash` powinien być oryginalnym tekstem czy hashem? Hash daje GDPR-safety i prywatność, oryginał daje retroaktywne debugowanie promptów. Decyzja deferowana do tech stack selectora.
- Hardcoded "10:00" w copy podsumowania — czy uwzględniać timezone usera? W MVP zakładamy local-time bez timezone-handling. Decyzja do potwierdzenia.
- Co dokładnie pokazuje ekran podsumowania sesji poza copy "jutro o 10:00"? Liczba przerobionych, % Wiem? **Resolved in Faza 4 / P4-3 (opcja b)**: liczba przerobionych + % Wiem, bez wykresów (v2).

## User Stories & Functional Requirements

### User Stories (US-1 → US-9)

**US-1 — Bezbolesne logowanie**
- *Jako* programista uczący się nowego stacka, *chcę* zalogować się jednym kliknięciem przez Google, *aby* pominąć friction zakładania konta + weryfikacji maila.
- **G/W/T:** *Given* niezalogowany user na stronie startowej, *when* kliknie "Zaloguj przez Google" i pomyślnie autoryzuje w Google, *then* system tworzy/odnajduje konto na podstawie `google_sub`, ustawia sesję i przenosi na ekran główny.

**US-2 — Wylogowanie**
- *Jako* zalogowany user, *chcę* móc się wylogować, *aby* zabezpieczyć fiszki na współdzielonym urządzeniu.
- **G/W/T:** *Given* zalogowany user, *when* kliknie "Wyloguj", *then* sesja/cookie zostaje wyczyszczone i user trafia na stronę startową.

**US-3 — Usunięcie konta**
- *Jako* user, *chcę* móc skasować konto i wszystkie moje dane jednym kliknięciem, *aby* zrealizować right-to-be-forgotten.
- **G/W/T:** *Given* zalogowany user w settings, *when* kliknie "Usuń konto" i potwierdzi w dialogu, *then* system kaskadowo usuwa profil, wszystkie Generations i wszystkie Cards usera, kończy sesję, przekierowuje na stronę startową.

**US-4 — Generacja paczki fiszek z tekstu**
- *Jako* programista po przeczytaniu fragmentu dokumentacji, *chcę* wkleić tekst (min. 500 znaków) i otrzymać 5 Q&A, *aby* przeskoczyć ręczne formułowanie pytań i odpowiedzi.
- **G/W/T (happy path):** *Given* zalogowany user na ekranie głównym z wklejonym tekstem ≥ 500 znaków, *when* kliknie [Generuj fiszki z AI], *then* w czasie p95 < 10s (max 30s) system zwraca dokładnie 5 fiszek Q&A i pokazuje je w widoku review.
- **G/W/T (zbyt krótki input):** *Given* tekst < 500 znaków, *when* user próbuje kliknąć [Generuj fiszki z AI], *then* przycisk jest disabled lub wyświetla się komunikat o minimalnej długości.
- **G/W/T (timeout):** *Given* generacja trwa > 30s, *when* timeout się wyzwoli, *then* user widzi friendly error + przycisk "Spróbuj ponownie".

**US-5 — Review i edycja paczki przed zatwierdzeniem**
- *Jako* user kontrolujący jakość fiszek, *chcę* edytować lub usuwać fiszki w wygenerowanej paczce przed zapisem, *aby* korygować błędy AI lub doprecyzowywać definicje.
- **G/W/T (edycja):** *Given* user w widoku review świeżej paczki, *when* edytuje pole Q lub A jednej fiszki i opuszcza pole, *then* zmiana zostaje zachowana lokalnie w widoku (jeszcze nie w bazie).
- **G/W/T (usunięcie):** *Given* user w widoku review, *when* kliknie X przy jednej fiszce, *then* fiszka znika z widoku (nie wchodzi do bazy po [Zatwierdź]).
- **G/W/T (zatwierdzenie):** *Given* user przejrzał paczkę, *when* kliknie [Zatwierdź i przejdź do nauki], *then* pozostałe fiszki są persystowane do bazy z `source='ai'`, `generation_id`=świeży, `leitner_box=1`, `next_review_at=now`, i system uruchamia sesję SRS na nich.

**US-6 — Sesja SRS z binarnym ratingiem**
- *Jako* user w sesji powtórek, *chcę* widzieć pytania, odsłaniać odpowiedź jednym klikiem i oceniać binarnie Wiem/Nie wiem, *aby* nauka była bez tarcia decyzyjnego.
- **G/W/T (pokaż odpowiedź):** *Given* user widzi pytanie, *when* kliknie "Pokaż odpowiedź", *then* system odsłania pole odpowiedzi i wyświetla [Wiem] [Nie wiem].
- **G/W/T (Wiem):** *Given* user odsłonił odpowiedź, *when* kliknie [Wiem], *then* `leitner_box` rośnie o 1 (max 5), `next_review_at = now + interval[box]`, system pokazuje następną fiszkę z kolejki.
- **G/W/T (Nie wiem):** *Given* user odsłonił odpowiedź, *when* kliknie [Nie wiem], *then* `leitner_box = 1`, `next_review_at = now + 1 dzień`, system pokazuje następną fiszkę z kolejki.

**US-7 — Ekran "Moje fiszki"**
- *Jako* user z biblioteką fiszek, *chcę* widzieć wszystkie moje fiszki w jednym miejscu z opcją edycji, usuwania oraz tworzenia nowej manualnej fiszki, *aby* mieć pełną kontrolę nad zawartością.
- **G/W/T (przeglądanie):** *Given* zalogowany user, *when* otworzy "Moje fiszki", *then* widzi listę wszystkich swoich fiszek (Q + A) posortowaną wg `created_at` desc (najnowsze paczki na górze), z opcją edycji każdej i opcją usunięcia każdej (z potwierdzeniem).
- **G/W/T (nowa pusta fiszka):** *Given* user na ekranie "Moje fiszki", *when* kliknie [+ Nowa fiszka], *then* system tworzy nowy rekord Card z `question=''`, `answer=''`, `source='manual'`, `generation_id=NULL`, `leitner_box=1`, `next_review_at=now`; rekord pojawia się w liście jako edytowalny i pozostaje wykluczony z sesji SRS dopóki user nie wypełni obu pól Q i A.

**US-8 — Podsumowanie sesji**
- *Jako* user, który skończył sesję, *chcę* widzieć podsumowanie i obietnicę następnej sesji, *aby* mieć poczucie domknięcia i wiedzieć kiedy wrócić.
- **G/W/T:** *Given* user przerobił wszystkie due-cards w sesji, *when* sesja się kończy, *then* widzi ekran z copy *"Dobra robota! Następna powtórka czeka na Ciebie jutro o ~10:00"*, liczbę przerobionych fiszek oraz procent ocen [Wiem] w bieżącej sesji.

**US-9 — Resilience generacji AI**
- *Jako* user pod presją czasu, *chcę* dostać konkretny error i retry zamiast wisieć na pustym loaderze, *aby* móc szybko zdecydować czy spróbować ponownie czy zmienić strategię.
- **G/W/T:** *Given* generacja trwa > 30s lub LLM zwraca error, *when* timeout/error się wydarza, *then* user widzi komunikat *"Generacja nie powiodła się — spróbuj ponownie albo spróbuj z krótszym/innym fragmentem"* + przycisk [Spróbuj ponownie] (który ponawia request z tym samym tekstem).

### Functional Requirements (FR-001 → FR-027)

#### Auth (FR-001 → FR-005)

| ID | FR |
|---|---|
| FR-001 | System udostępnia przycisk "Zaloguj przez Google" na stronie startowej |
| FR-002 | System przeprowadza OAuth flow Google, tworzy User record przy pierwszym logowaniu (`email`, `google_sub`, `display_name`) lub odnajduje istniejący po `google_sub` |
| FR-003 | System ustawia sesję/cookie po pomyślnym logowaniu i utrzymuje ją do wylogowania lub usunięcia konta |
| FR-004 | System udostępnia endpoint wylogowania, który czyści sesję/cookie i przenosi na stronę startową |
| FR-005 | System udostępnia akcję "Usuń konto", która po potwierdzeniu kaskadowo kasuje User + wszystkie powiązane Generations + Cards i wylogowuje usera |

#### Generation (FR-006 → FR-014)

| ID | FR |
|---|---|
| FR-006 | Ekran główny zawiera pole tekstowe z placeholderem *"Wklej kod lub dokumentację, z której chcesz się pouczyć"* |
| FR-007 | Ekran główny zawiera przycisk [Generuj fiszki z AI], aktywny gdy pole tekstowe ma **co najmniej 500 znaków** (P4-1) |
| FR-008 | Kliknięcie [Generuj fiszki z AI] uruchamia request do LLM z promptem zwracającym dokładnie 5 par Q&A jako JSON |
| FR-009 | Podczas generacji system wyświetla loader, blokujący interakcję |
| FR-010 | System enforce'uje NFR: target p95 < 10s, hard cutoff 30s |
| FR-011 | Po sukcesie generacji system wyświetla 5 fiszek w widoku review (Q + A widoczne, edytowalne) |
| FR-012 | W widoku review każda fiszka ma edytowalne pole Q i edytowalne pole A oraz przycisk X (usuń z paczki) |
| FR-013 | Widok review NIE pozwala dodać nowej fiszki ani zmienić liczby fiszek (poza usunięciem) |
| FR-014 | Po kliknięciu [Zatwierdź i przejdź do nauki] system zapisuje pozostałe fiszki do DB (`source='ai'`, `leitner_box=1`, `next_review_at=now`, `generation_id` wskazujący na świeżą Generation) i uruchamia sesję SRS |

#### SRS session (FR-015 → FR-022)

| ID | FR |
|---|---|
| FR-015 | Sesja SRS pobiera kolejkę fiszek z `next_review_at <= now` należących do zalogowanego usera |
| FR-016 | Sesja prezentuje fiszki sekwencyjnie, jedna na ekranie, pokazując tylko Q |
| FR-017 | Przycisk "Pokaż odpowiedź" odsłania A i ujawnia [Wiem] / [Nie wiem] |
| FR-018 | Kliknięcie [Wiem] zwiększa `leitner_box` o 1 (cap 5) i ustawia `next_review_at = now + interval[box]` |
| FR-019 | Kliknięcie [Nie wiem] ustawia `leitner_box = 1` i `next_review_at = now + 1 dzień` |
| FR-020 | Po ocenie fiszki system pokazuje następną z kolejki bez dodatkowego klikania |
| FR-021 | Interwały pudełek: box1=1d, box2=3d, box3=7d, box4=14d, box5=30d |
| FR-022 | Po przerobieniu wszystkich fiszek z kolejki system pokazuje ekran podsumowania zawierający: copy *"Następna powtórka jutro o ~10:00"*, liczbę przerobionych fiszek, procent ocen [Wiem] (P4-3) |

#### Library "Moje fiszki" (FR-023 → FR-026, FR-028)

| ID | FR |
|---|---|
| FR-023 | System udostępnia ekran "Moje fiszki" pokazujący wszystkie fiszki zalogowanego usera (Q + A) |
| FR-024 | Lista jest posortowana wg `created_at` desc — najnowsze fiszki na górze (P4-2) |
| FR-025 | Każda fiszka na liście ma akcje: edytuj (Q i A) oraz usuń (z potwierdzeniem) |
| FR-026 | Edycja fiszki w "Moje fiszki" zmienia tylko Q i/lub A — `leitner_box` i `next_review_at` pozostają bez zmian |
| FR-028 | Na ekranie "Moje fiszki" przycisk [+ Nowa fiszka] tworzy nowy rekord Card z `question=''`, `answer=''`, `source='manual'`, `generation_id=NULL`, `leitner_box=1`, `next_review_at=now`; rekord pojawia się w liście jako edytowalny; jest wykluczony z kolejki SRS dopóki oba pola Q i A nie zostaną wypełnione (BR-7) |

#### Errors / resilience (FR-027)

| ID | FR |
|---|---|
| FR-027 | Przy timeout (>30s) lub błędzie generacji LLM system pokazuje friendly error + przycisk [Spróbuj ponownie], który ponawia request z tym samym tekstem |

### Decyzje granularne Fazy 4

| ID | Decyzja | Wynik |
|---|---|---|
| P4-1 | Minimalna długość wklejonego tekstu | **500 znaków** (opcja b). Eliminuje przypadek "wkleiłem nazwę funkcji" i wymusza wartościowy kontekst dla LLM |
| P4-2 | Sortowanie "Moje fiszki" | **`created_at` desc** (opcja b). Przewidywalne archiwum chronologiczne, bez dublowania logiki kolejkowania z sesji SRS |
| P4-3 | Zawartość ekranu podsumowania | **Copy + statystyki** (opcja b). Liczba przerobionych fiszek + procent [Wiem]. Wykresy i analityka trend → v2 |

### Open Questions z Fazy 4

- **NFR latencji** (FR-010 p95<10s, 30s cutoff) — wymaga konkretnej metryki monitoringu w produkcji. W MVP zakładamy: bez dashboardu, tylko sentry-style error tracking na timeoutach. Decyzja deferowana do tech stack selectora.
- **Confirmation dialog dla usunięcia fiszki vs konta** — czy dialog tekstowy ("Czy na pewno?"), czy native confirm(), czy custom modal? Decyzja UI deferowana do implementacji.
- **Co jeśli sesja SRS jest pusta** (żadnych due-cards)? UX TBD — komunikat "Brak fiszek na dziś, wracaj jutro o ~10:00" lub re-direct na ekran główny? Decyzja deferowana do implementacji UI.

## Business Logic

### Jednozdaniowa reguła biznesowa

> **User kontroluje treść fiszki (Q, A); algorytm Leitner-light kontroluje jej harmonogram (`leitner_box`, `next_review_at`); LLM jest dostawcą surowca podlegającym kuratorskiej zgodzie usera (paczka nie wchodzi do bazy bez [Zatwierdź]). Te trzy domeny są rozłączne i system tej rozłączności nie łamie.**

Ta reguła to fundament tożsamości 10xCards. Każda decyzja produktowa, która próbowałaby zatrzeć granicę między tymi trzema autorytetami (np. "AI sam zapisuje fiszki do bazy" / "user może ręcznie ustawić `leitner_box`" / "algorytm modyfikuje treść"), narusza ją.

### Business rules (derywaty)

| ID | Reguła |
|---|---|
| BR-1 | AI generation zwraca **dokładnie 5 fiszek** per request — invariant product promise |
| BR-2 | Paczka świeżo wygenerowana **nie jest persystowana** do bazy do momentu [Zatwierdź] — user-confirmation gate |
| BR-3 | Edycja fiszki w "Moje fiszki" zmienia **tylko** `question` i/lub `answer`; nigdy nie resetuje `leitner_box` / `next_review_at` |
| BR-4 | Brak UI/API do bezpośredniej zmiany `leitner_box` lub `next_review_at` przez usera — jedyne źródło tych zmian to algorytm SRS w odpowiedzi na rating [Wiem/Nie wiem] |
| BR-5 | Każda fiszka ma `source ∈ {'ai', 'manual'}` — AI-fiszki pochodzą z paczki generacji (`generation_id` wymagany), manualne tworzone przez przycisk [+ Nowa fiszka] na ekranie "Moje fiszki" (`generation_id=NULL`, FR-028) |
| BR-6 | Każda AI-fiszka ma niezbywalne `generation_id`; rekord Generation żyje co najmniej tak długo jak najdłużej żyjąca jego fiszka |
| BR-7 | Sesja SRS = FIFO fiszek z `next_review_at <= now AND user_id = current_user.id AND question != '' AND answer != ''` — drafty (puste fiszki manualne z FR-028) są wykluczone z kolejki dopóki user nie wypełni obu pól |
| BR-8 | Usunięcie User kaskaduje wszystkie powiązane Generations i Cards — bez wyjątków, bez soft-delete |
| BR-9 | Brak współdzielenia danych między userami — każde zapytanie scoped do `user_id` zalogowanego |

### Data model (finalny dla MVP)

```
User
  id: PK
  email: string (unique, z Google)
  google_sub: string (unique, stabilny identyfikator Google)
  display_name: string (nullable, z Google profile)
  created_at: timestamp

Generation
  id: PK
  user_id: FK → User (cascade delete)
  source_text_hash: string (SHA-256 wkleju — patrz D5.1)
  source_text_length: int (długość oryginału, do analityki bez naruszenia prywatności)
  created_at: timestamp

Card
  id: PK
  user_id: FK → User (cascade delete)
  generation_id: FK → Generation (nullable: NOT NULL dla source='ai', NULL dla source='manual')
  question: text  -- może być pusty string dla manualnych draftów (FR-028)
  answer: text    -- może być pusty string dla manualnych draftów (FR-028)
  source: enum ('ai' | 'manual')  -- 'ai' = z paczki generacji, 'manual' = utworzona z [+ Nowa fiszka] na ekranie "Moje fiszki"
  leitner_box: int (1..5, default 1)
  next_review_at: timestamp (default = created_at)
  created_at: timestamp
  updated_at: timestamp
```

### Decyzje granularne Fazy 5

| ID | Decyzja | Wynik |
|---|---|---|
| D5.1 | Persystencja source text | **(b) hash only** (SHA-256). Privacy-by-design. Zero data liability dla code/dokumentacji firmowej |
| D5.2 | Język LLM Q&A | **(c) match input language**. LLM dostaje instrukcję "Q&A in the same language as the input". Zero translation loss |
| D5.3 | Limity długości pól | **Soft UI limits, zero hard DB constraints**. Q ≈200, A ≈1000, input min 500. LLM może okazjonalnie przekroczyć — akceptujemy |
| D5.4 | LLM zwraca != 5 fiszek | **(a) hard fail + retry**. BR-1 to product promise. Walidujemy count w odpowiedzi LLM; jeśli != 5 → friendly error + [Spróbuj ponownie] |

### Open Questions z Fazy 5

- **Retry storm**: co jeśli LLM kategorycznie nie umie zwrócić 5 fiszek z konkretnego inputu (3 retries z rzędu zawiodą)? Czy MVP ma after-N-retries fallback (np. "spróbuj z innym fragmentem"), czy zostawiamy nieskończone retry? Decyzja deferowana do implementacji.
- **`source_text_hash` per-user salting**: czy sól per user (zapobiega cross-user trackingowi "ten tekst już ktoś fiszkował")? W MVP zakładamy: brak soli, prosty SHA-256. Privacy edge case — surfacie do code review.
- **Walidacja JSON output od LLM**: gdzie dokładnie walidujemy structure (server-side oczywiście, ale czy framework typu Zod / Pydantic / inny)? Decyzja deferowana do tech stack selectora.

## Stack-Openness Sketch

### Product type (binding — frontmatter)

**`web_app`**. Frontend + backend, dostęp przez przeglądarkę. Nie mobile-native, nie CLI, nie library. Źródło: seed linia 32 — *"Aplikacje mobilne (na początek tylko web)"*.

### Language family (binding — frontmatter, D6.1)

**`typescript`** (a). Powód: ekosystem JS/TS daje full-stack architecture w jednym języku, minimalizuje koszt context-switchingu między FE a BE, wspiera AI/Auth/Postgres/Web bez kompromisów funkcjonalnych.

### Konieczne komponenty (constraints na stack — co stos MUSI obsłużyć)

| Komponent | Wymagane bo |
|---|---|
| LLM integration (HTTP API call + JSON validation) | BR-1, FR-008, D5.4 |
| OAuth client (Google) | FR-001..003, US-1 |
| Relacyjna baza danych | Data model: 3 tabele z FK + cascade delete |
| Web UI (multi-screen flow) | US-1..9 |
| SHA-256 hashing | Generation.source_text_hash |
| Session storage (cookie-based) | FR-003 |

### Preferencje opcjonalne (non-binding, kontekst dla `/10x-tech-stack-selector`)

| ID | Decyzja | Wybór | Powód |
|---|---|---|---|
| D6.2 | Hosting paradigm | **Managed PaaS / full-stack** (Vercel lub Railway) | Szybki ręczny deploy bez ruszania infrastruktury serwerowej — fit z Cut-4 (brak CI/CD w MVP) |
| D6.3 | Database | **PostgreSQL** (preferowany managed — np. Supabase, Neon, Railway Postgres) | Stabilna baza relacyjna z natywnym FK + cascade. Managed eliminuje koszty utrzymania |
| D6.4 | LLM provider | **OpenAI (gpt-4o-mini) lub Anthropic (Claude Haiku)** — modele klasy "mini" | Szybki output (NFR p95 < 10s), tani cost-per-request, stabilny JSON mode/output |

### Świadomie otwarte (deferred do `/10x-tech-stack-selector`)

- Konkretny framework FE/BE (Next.js? Astro? Remix? Hono+React? Sveltekit?)
- Full-stack monorepo vs split FE/BE
- ORM / DB access layer (Prisma? Drizzle? Kysely? raw SQL?)
- Auth library / SDK (NextAuth/Auth.js? Clerk? Lucia? własnoręcznie?)
- Konkretny managed DB provider (Supabase? Neon? Railway?)
- LLM SDK (oficjalny OpenAI/Anthropic SDK? Vercel AI SDK abstraction?)
- JSON validation library (Zod / TypeBox / Valibot / inne)
- Component library / styling (shadcn? Tailwind? CSS modules?)
- Test runner (Vitest? Playwright dla E2E?)

### Open Questions z Fazy 6

- **Vercel AI SDK vs natywne SDK providera**: abstrakcja pozwala swap providera (OpenAI ↔ Anthropic), ale dodaje warstwę. Decyzja deferowana do stack-selector.
- **Supabase (DB + Auth + Storage w jednym)** vs **Vercel/Neon Postgres + osobny auth (np. NextAuth/Clerk)**: Supabase konsoliduje ale ucieka się w ekosystem. Decyzja deferowana do stack-selector.
- **Single Next.js app (full-stack)** vs **split FE+BE**: full-stack daje deployment simplicity (fit z Cut-4); split daje testability. Decyzja deferowana do stack-selector.

---

## Sesja shaping zamknięta

Wszystkie 6 faz `/10x-shape` ukończone. Anti-pattern checks: empty-CRUD GREEN, MVP-too-big AMBER + świadomy override. Shape-notes gotowy jako input do `/10x-prd`.
