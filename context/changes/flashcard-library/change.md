---
change_id: flashcard-library
title: Flashcard library
status: new
created: 2026-06-13
---

# Flashcard library ("Moje fiszki")

Roadmap slice **S-03**. User can open "Moje fiszki" and:

- see all their cards (AI + manual) sorted `created_at` desc,
- edit Q and/or A of any card **without** changing `leitner_box` / `next_review_at` (FR-026 / BR-3 — critical),
- delete a card with a confirmation step,
- create an empty card manually via **[+ Nowa fiszka]** (the card appears editable and is excluded from the SRS queue until both Q and A are filled).

**PRD refs:** US-07, FR-023, FR-024, FR-025, FR-026, FR-028.
**Prerequisite:** F-01 (db schema — tables `cards`, `generations`).
**Lane:** B (`feature/flashcard-library`). Parallel with lane A = F-02 (`google-oauth-switch`).
