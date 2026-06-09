---
project: 10xCards
version: 2
status: draft
created: 2026-05-24
updated: 2026-05-24
changelog:
  - v2 (2026-05-24): FR-028 added (manual empty-card creation from "Moje fiszki"); Cut-1 reverted; Secondary Success Criterion now measurable in MVP; Non-Goal "No manual flashcard creation" removed; Open Question #11 resolved
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 4
  hard_deadline: null
  after_hours_only: true
---

# 10xCards — Product Requirements Document

## Vision & Problem Statement

Tworzenie wysokiej jakości fiszek edukacyjnych jest pracą kognitywną, składającą się z trzech odrębnych aktów: editorial selekcji (co z materiału jest warte zafiszkowania), formułowania pytania i formułowania odpowiedzi. Wszystkie trzy konsumują tę samą energię intelektualną, która powinna iść w naukę. Programista wchodzący w nowy stack technologiczny styka się z tym bólem w momencie pierwszego zapoznania z materiałem — czyta nową dokumentację i wie, że powinien zrobić fiszki, ale nie ma siły na 45 minut przepisywania po przeczytaniu. Bezpośredni koszt to 2–3× więcej czasu na tworzeniu fiszek niż na nauce; pośredni — szybsze zapominanie materiału i wolniejsze przyswajanie nowej wiedzy w pracy zawodowej.

Istnieją silne modele językowe. Istnieją sprawdzone algorytmy spaced repetition. Ale nikt nie połączył ich w jednym spójnym workflow — dziś user żongluje zewnętrznym chatem konwersacyjnym AI plus ręcznym importem do osobnej aplikacji powtórek, a friction tego workflow zabija nawyk. Wartość 10xCards leży w integracji tych dwóch sprawdzonych technologii w pojedynczy ruch produktowy — od wklejonego tekstu do aktywnej sesji nauki w pod dwie minuty — a nie w wymyślaniu nowego AI ani nowego algorytmu SRS.

## User & Persona

**Primary persona — Programista uczący się nowego stacka.**

Programista (junior lub senior) wchodzący w nową technologię: framework, język, bibliotekę, paradygmat lub ekosystem. Czyta oficjalną dokumentację, książki techniczne, artykuły, kod źródłowy. Wie, że spaced repetition byłoby idealne do utrwalania API, konceptów i idiomów, ale dzisiaj rezygnuje, bo koszt tworzenia fiszek przewyższa percepcyjny zysk.

**Kontekst użycia.** Tryb pierwszego zapoznania z materiałem. Sesje krótkie do średnich (15–45 min), inicjowane bezpośrednio po przeczytaniu fragmentu dokumentacji. Persona oczekuje od AI długich, kontekstowych odpowiedzi, które pomagają zbudować rozumienie, a nie tylko zapamiętać fakt.

**Cel persony.** Trwałe rozumienie nowego stacka w tempie pracy zawodowej, bez wypalenia.

**Bonus property.** Persona jest blisko właściciela produktu (dogfooding) — pętla feedbacku jest krótka, walidacja N=1 jest dostępna od dnia 1.

### Secondary persona

Studenci kierunków o wysokiej gęstości materiału (medycyna, prawo, ekonomia), prawnicy w aplikacji, poligloci — wszyscy "utrwalający wiedzę". Świadomie poza MVP: każda z tych person ma własne wymagania (np. krótka sesja awaryjna pod egzamin, multi-language flow), które rozcieńczyłyby produktową ostrość MVP. Kandydaci do v2.

## Success Criteria

### Primary

- Acceptance rate AI-generated fiszek wynosi ≥ 75% — mierzone jako stosunek liczby fiszek persystowanych po [Zatwierdź] do liczby fiszek wygenerowanych w paczce, agregowane per user przez okres pierwszych 30 dni od pierwszej generacji.

### Secondary

- Co najmniej 75% wszystkich fiszek w bibliotece usera pochodzi z generacji AI — mierzone jako stosunek liczby fiszek z `source='ai'` do całkowitej liczby fiszek w bibliotece usera, agregowane per user przez okres pierwszych 30 dni od pierwszej generacji. Manualne tworzenie pustych fiszek (FR-028) zapewnia realny denominator dla tego kryterium.

### Guardrails

- Żadna fiszka nie zostaje zapisana do trwałego storage bez świadomej zgody usera wyrażonej kliknięciem [Zatwierdź] na widoku review świeżej paczki.
- Wklejony przez usera tekst źródłowy nie pozostawia śladu w operator-accessible storage po zakończeniu obsługi requestu, który go skonsumował; system zachowuje wyłącznie nieodwracalny identyfikator i długość.
- Żadne dane (fiszki, historia generacji, profil) jednego usera nie są widoczne ani działalne przez innego usera.
- Akcja "Usuń konto" trwale i nieodwracalnie usuwa wszystkie dane usera, bez stanu pośredniego "ukryte do skasowania".

## User Stories

### US-01: Sign-in via external OAuth provider

- **Given** an unauthenticated visitor on the landing page
- **When** they trigger the sign-in action and complete OAuth on the configured external provider
- **Then** the system creates or reconnects their account on the basis of the OAuth profile, establishes a session, and lands them on the main screen

#### Acceptance Criteria
- A first-time sign-in auto-creates an account bound to the OAuth profile (email + stable external identifier + optional display name).
- A returning sign-in reconnects to the existing account based on the stable external identifier.
- The user is not asked to confirm an email, set a password, or complete any additional onboarding step.

### US-02: Sign out

- **Given** a signed-in user
- **When** they trigger the sign-out action
- **Then** the session is terminated and the user is returned to the landing page

#### Acceptance Criteria
- After sign-out, no gated screen is accessible without a fresh sign-in.

### US-03: Permanently delete account

- **Given** a signed-in user
- **When** they invoke "Usuń konto" and confirm in a confirmation dialog
- **Then** the system permanently and irreversibly removes the user's profile, all of their generations, and all of their cards, terminates the session, and redirects to the landing page

#### Acceptance Criteria
- No data belonging to the deleted user remains accessible by any path after the action completes.
- A re-sign-in via the same OAuth profile after deletion produces a fresh, empty account (treated as a first-time sign-in).

### US-04: Generate a flashcard batch from pasted source text

- **Given** a signed-in user on the main screen with at least 500 characters of source text in the paste field
- **When** they trigger [Generuj fiszki z AI]
- **Then** within the latency target (p95 under 10 seconds, hard cutoff 30 seconds) the system returns a batch of exactly five question/answer cards and renders them in the post-generation review view

#### Acceptance Criteria
- If the source text contains fewer than 500 characters, the generation action is unavailable (or surfaces a clear minimum-length message).
- If the request exceeds the hard cutoff or returns an invalid response, the user sees a friendly error and a retry action (see US-09).
- The generated question/answer pairs are in the same language as the source text.

### US-05: Review and edit a freshly generated batch before saving

- **Given** a signed-in user looking at a freshly generated batch in the review view
- **When** they edit the question or answer text of any card, or remove a card with the delete action, then click [Zatwierdź i przejdź do nauki]
- **Then** the remaining cards are persisted and an SRS session is started on them immediately

#### Acceptance Criteria
- Edits to question or answer fields are preserved locally while the user is reviewing; they are only persisted once the user confirms.
- A card removed from the batch in the review view does not enter the user's library.
- The review view does not offer an action to add a new card; manual card creation is available from the "Moje fiszki" library screen (see US-07 / FR-028).
- Cards persisted from the batch are tagged as AI-generated and linked to the originating generation event.

### US-06: SRS session with binary self-rating

- **Given** a signed-in user with at least one card whose next-review time has arrived
- **When** they enter the SRS session
- **Then** they see one card at a time showing only its question; revealing the answer exposes [Wiem] and [Nie wiem]; each rating immediately advances to the next due card

#### Acceptance Criteria
- Clicking [Wiem] advances the card one box up the Leitner ladder (capped at box 5) and re-schedules its next review per the new box's interval.
- Clicking [Nie wiem] resets the card to box 1 and re-schedules its next review for one day later.
- The session ends when no more due cards remain; the user lands on a summary screen (see US-08).

### US-07: Browse and curate the personal flashcard library

- **Given** a signed-in user with at least one persisted card
- **When** they open "Moje fiszki"
- **Then** they see a list of all their cards (question and answer visible), sorted by creation time with newest first, with edit and delete actions on each card

#### Acceptance Criteria
- Editing a card from this screen changes only its question and/or answer; the card's box position and next-review time are not affected.
- Deleting a card requires a confirmation step.
- The list shows both AI-generated cards and manually created cards.
- The user can create a new empty card via a [+ Nowa fiszka] action; the card is persisted immediately with empty question and answer, appears in the list as editable, and is excluded from SRS sessions until both the question and answer fields are filled in (see FR-028).

### US-08: Session summary on completion

- **Given** a signed-in user who has just rated the last due card in the session
- **When** the session concludes
- **Then** the system shows a summary screen with the next-session copy ("Następna powtórka jutro o ~10:00"), the count of cards reviewed in the just-completed session, and the percentage of [Wiem] ratings in the session

#### Acceptance Criteria
- The summary contains no charts, trend visualizations, or cross-session analytics in MVP.
- The "10:00" copy is a friendly default; actual due times are computed per card, so the user may legitimately enter the next session earlier or later.

### US-09: Recover from a failed or timed-out generation request

- **Given** a signed-in user who has just triggered generation
- **When** the request exceeds the hard 30-second cutoff or returns a response that does not contain exactly five well-formed question/answer pairs
- **Then** the user sees a friendly error message and a [Spróbuj ponownie] action that re-issues the same request with the same source text

#### Acceptance Criteria
- The system does not persist any cards from a failed or invalid generation.
- The user is not stuck on a blank loader past the hard cutoff.

## Functional Requirements

### Authentication & Account

- FR-001: An unauthenticated visitor can initiate sign-in via the configured external OAuth provider from the landing page. Priority: must-have
- FR-002: A first-time user completing OAuth sign-in has an account auto-created bound to their OAuth profile (email, stable external identifier, optional display name); a returning user is reconnected to their existing account based on the stable external identifier. Priority: must-have
- FR-003: A signed-in user has a session that persists across page reloads until they sign out or delete their account. Priority: must-have
- FR-004: A signed-in user can sign out, terminating their session and returning to the landing page. Priority: must-have
- FR-005: A signed-in user can permanently delete their account, which removes their profile and cascades deletion of all their generations and cards. Priority: must-have

### Generation

- FR-006: A signed-in user can paste source text into a single field on the main screen (placeholder: "Wklej kod lub dokumentację, z której chcesz się pouczyć"). Priority: must-have
- FR-007: A signed-in user can trigger AI generation only when the source text contains at least 500 characters. Priority: must-have
- FR-008: A signed-in user triggering generation has the system request from the external LLM exactly 5 question/answer pairs derived from the pasted text, with the instruction that the pairs use the same language as the source text. Priority: must-have
- FR-009: A signed-in user sees continuous in-progress feedback during a generation request, and interaction with the generation form is blocked until the request resolves. Priority: must-have
- FR-010: A signed-in user receives the generated batch as exactly 5 editable question/answer cards in a review view after a successful generation. Priority: must-have
- FR-011: A signed-in user can edit the question and/or answer text of any card in the post-generation review view. Priority: must-have
- FR-012: A signed-in user can remove a single card from the post-generation review view before confirming the batch. Priority: must-have
- FR-013: A signed-in user cannot add a new card from within the post-generation review view; the review view is exclusively for curating the AI-generated batch, and manual card creation lives on the "Moje fiszki" screen (FR-028). Priority: must-have
- FR-014: A signed-in user can confirm the post-generation batch via [Zatwierdź i przejdź do nauki], which persists all remaining cards (tagged as AI-generated and linked to the originating generation event) and immediately starts an SRS session containing them. Priority: must-have

### SRS Session

- FR-015: A signed-in user starting an SRS session sees only their own cards whose next-review time has arrived. Priority: must-have
- FR-016: A signed-in user in a session sees one card at a time, with only its question initially visible. Priority: must-have
- FR-017: A signed-in user can reveal the answer of the current card, which then exposes the [Wiem] and [Nie wiem] actions. Priority: must-have
- FR-018: A signed-in user clicking [Wiem] advances the current card up one box in the Leitner ladder (capped at box 5) and re-schedules the card for the interval associated with its new box. Priority: must-have
- FR-019: A signed-in user clicking [Nie wiem] resets the current card to box 1 and re-schedules the card for one day later. Priority: must-have
- FR-020: A signed-in user, after rating a card, immediately sees the next due card without additional interaction. Priority: must-have
- FR-021: The Leitner ladder uses these intervals: box 1 = 1 day, box 2 = 3 days, box 3 = 7 days, box 4 = 14 days, box 5 = 30 days. Priority: must-have
- FR-022: A signed-in user finishing all due cards in the session sees a summary screen containing the next-session promise ("Następna powtórka jutro o ~10:00"), the count of cards reviewed in the just-completed session, and the percentage of [Wiem] ratings in the session. Priority: must-have

### Library ("Moje fiszki")

- FR-023: A signed-in user can open a "Moje fiszki" screen listing all of their cards with question and answer visible per card. Priority: must-have
- FR-024: A signed-in user sees their card list sorted by creation time, newest first. Priority: must-have
- FR-025: A signed-in user can edit any single card (question and/or answer) and can delete any single card (with a confirmation step) from the "Moje fiszki" screen. Priority: must-have
- FR-026: A signed-in user editing a card from "Moje fiszki" changes only its question and/or answer; the card's Leitner box position and next-review time are unaffected. Priority: must-have
- FR-028: A signed-in user on the "Moje fiszki" screen can trigger a [+ Nowa fiszka] action that immediately persists a new card with empty question, empty answer, `source` set to `manual`, no linked generation, and the same initial Leitner defaults as any other new card (`leitner_box = 1`, `next_review_at = now`); the new card appears in the library list as editable but is excluded from SRS sessions until both the question and answer fields are filled in (enforced at the SRS-queue level, see Business Logic). Priority: must-have

### Errors & Recovery

- FR-027: A signed-in user whose generation request times out (>30 s) or returns a response that does not contain exactly five well-formed question/answer pairs sees a friendly error and a [Spróbuj ponownie] action that re-issues the same request with the same source text. Priority: must-have

## Non-Functional Requirements

- A signed-in user triggering generation receives a complete batch within 10 seconds at the 95th percentile, and is never blocked for more than 30 seconds before the product surfaces a clear error and recovery action.
- Source text submitted by a user for generation leaves no recoverable trace in operator-accessible storage after the request that consumed it completes; the product retains only a non-reversible identifier and the text's length for deduplication and analytics.
- Generated question and answer pairs are produced in the same language as the source text the user pasted.
- A signed-in user encounters soft length advisories around 200 characters per question and 1000 characters per answer, but the product does not block longer content from being saved.
- No card, generation event, or profile data belonging to one user is visible to or actionable by any other user.
- A generation request whose response does not contain exactly five well-formed question/answer pairs is surfaced as a recoverable error rather than persisted; the user can retry with the same source text.

## Business Logic

**One-sentence rule.** User kontroluje treść fiszki (pytanie i odpowiedź); algorytm Leitner-light kontroluje jej harmonogram (pozycję w drabinie pudełek i termin następnej powtórki); AI jest dostawcą surowca podlegającym kuratorskiej zgodzie usera — paczka nie wchodzi do biblioteki bez kliknięcia [Zatwierdź], a te trzy domeny są rozłączne i produkt tej rozłączności nie łamie.

**Inputs the rule consumes** (user-facing). Wklejony przez usera fragment tekstu źródłowego o długości co najmniej 500 znaków jest surowcem do generacji. Decyzje kuratorskie usera w widoku review świeżej paczki (edycja treści, usunięcie pojedynczych fiszek, zatwierdzenie pozostałych) są aktem kontroli jakości — bez ich pozytywnego wyniku żadna fiszka nie wchodzi do biblioteki. Binarne oceny [Wiem] / [Nie wiem] podczas sesji powtórek są jedynym wejściem do scheduler'a — user nie ma żadnej innej drogi, żeby wpłynąć na harmonogram swoich fiszek.

**Output**. Zbiór trwałych fiszek typu pytanie/odpowiedź należących wyłącznie do konkretnego usera, z deterministycznym harmonogramem powtórek opartym o drabinę pudełek z interwałami 1, 3, 7, 14 i 30 dni. Każda fiszka pamięta swoje pochodzenie (AI-generated z konkretnej paczki generacji lub manualnie utworzona przez usera z ekranu "Moje fiszki"); AI-fiszki są niezbywalnie powiązane z aktem generacji, manualne pozostają autonomiczne. Fiszka z pustym pytaniem lub pustą odpowiedzią (draft po manualnym utworzeniu, jeszcze nieuzupełniony) jest świadomie wykluczona z kolejki sesji SRS — pojawia się dopiero gdy oba pola zostaną wypełnione.

**User encounter**. Surowy tekst wchodzi do produktu przez pojedyncze pole; po krótkiej chwili produkt zwraca pięcioelementową propozycję paczki, którą user przegląda, edytuje i selektywnie odrzuca; po świadomym [Zatwierdź] paczka wchodzi w cykl powtórek; kolejne sesje są krótkim strumieniem fiszek, których termin powtórki dziś nadszedł, ocenianych binarnie, kończących się jednoekranowym podsumowaniem i obietnicą następnej sesji.

## Access Control

Authentication via a single external OAuth provider. There is no email + password registration flow, no password reset flow, no email verification flow, and no alternative authentication path in MVP. The motivation is to remove all onboarding friction: the persona (a developer) is overwhelmingly likely to already have an account with the chosen provider, and zero-friction onboarding is load-bearing for the dogfooding loop starting on day one.

Required auth-related capabilities in MVP:

- Sign-in via the external OAuth provider, establishing a session.
- Sign-out, terminating the session.
- Permanent account deletion, cascading removal of the user's profile, all of their generations, and all of their cards.

Role model is flat: one user equals one personal library. There are no admin, viewer, contributor, or other roles. Every user can read and modify only their own data. Sharing decks or collaborative editing is explicitly out of MVP scope.

The choice of specific OAuth provider, identity-library vendor, and session-storage mechanism are downstream decisions, not PRD-level commitments.

## Non-Goals

- **No decks, sets, topics, or folders.** All of a user's cards live in a single flat library. Organization is a v2 question once libraries grow beyond a few hundred cards.
- **No alternative authentication paths.** No email + password, no second OAuth provider, no SSO, no passwordless email. v2 candidates if non-developer personas emerge.
- **No configurable session schedule.** The "10:00" reference in the next-session copy is a hardcoded friendly default; per-card due times govern actual availability. User-configurable schedule is a v2 question.
- **No richer rating granularity.** Rating is binary (Wiem / Nie wiem); no Hard / Good / Easy grades; no half-knew option. Richer algorithms (SM-2, FSRS, Anki-style) are v2 candidates contingent on adding richer ratings.
- **No notifications, push, or email reminders.** The user pulls the product open; the product does not push.
- **No mobile or desktop native applications.** Web-only in MVP.
- **No deck sharing, collaboration, or multi-user features.** Single-user libraries only.
- **No import from PDF, DOCX, or other document formats.** Copy-paste only.
- **No user-facing data export (GDPR Article 20 portability).** Right-to-be-forgotten (Article 17) is covered by account deletion; data portability is deferred to v2.
- **No automated CI/CD pipelines in MVP.** First deployment is manual; pipeline automation lands after MVP launch.
- **No user-facing settings screen.** Defaults are hardcoded.

## Open Questions

1. **Guardrails completeness.** — Are the four guardrails listed in `## Success Criteria` exhaustive, or should additional ones (e.g., availability floor, accessibility minimum) be added? Owner: user. Block: no.
2. **Target scale beyond initial dogfooding.** — `target_scale.users` is set to `small` based on day-1 dogfooding context; what is the target scale by month 3, month 6, month 12 (if any growth target is meaningful)? Owner: user. Block: no.
3. **Browser support / accessibility floor.** — The PRD does not state minimum supported browser versions or accessibility level. Owner: user. Block: no.
4. **Latency observability.** — Non-Functional Requirements include a p95 latency target, but there is no defined operator-visible mechanism for monitoring whether the target holds in production. Owner: user (deferable to tech-stack-selection). Block: no.
5. **Retry storm handling.** — If the LLM repeatedly fails to return exactly five well-formed cards for a given input (e.g., three retries in a row fail), what is the user-visible escape? Suggest a different fragment? Allow override-save? Owner: user. Block: no.
6. **Source-text deduplication semantics.** — The non-reversible identifier kept for source text enables deduplication; should it be salted per-user (preventing cross-user "this text has been seen" inferences), or global? Owner: user. Block: no.
7. **Timezone handling for "10:00" copy.** — The "Następna powtórka jutro o ~10:00" copy is hardcoded local time; should it adapt to user timezone or remain a friendly default? Owner: user. Block: no.
8. **Empty SRS session UX.** — When a signed-in user opens the product and has zero due cards, what do they see? An empty-state with the next due-card time? A redirect to the main screen? An invitation to generate a new batch? Owner: user. Block: no.
9. **Confirmation dialog pattern.** — Deletion of a card and deletion of an account both require confirmation; the specific confirmation pattern (typed confirmation, modal, native browser confirm) is not specified. Owner: user (deferable to implementation). Block: no.
10. **Maximum source text length.** — The minimum is 500 characters; no maximum is set. Is there an upper bound that should be communicated (and at what length does generation quality or cost become a concern)? Owner: user. Block: no.
11. **GDPR data portability (Article 20).** — Account deletion satisfies the right to be forgotten; data export (machine-readable copy of one's own data) is not in MVP. Should it be? Owner: user. Block: no.
12. **Future OAuth providers.** — v2 candidates: second OAuth provider for the developer persona, email + password path for non-developer personas. Owner: user. Block: no.
