---
change_id: api-error-correlation
title: Korelacja błędu 500 z POST /api/cards z logiem serwera przez opaque ref
status: archived
created: 2026-08-06
updated: 2026-08-06
archived_at: 2026-08-06T20:06:42Z
---

## Notes

dodać korelację między odpowiedzią błędu 500 z POST /api/cards a wpisem w logu
serwera przez opaque ref, bez łamania redakcji z Ryzyka #2

**Pochodzenie.** Zmiana wyszła z diagnozy niesprawnego dodawania fiszek na
produkcji (`10xcards30.turolmar1-775.workers.dev`). Diagnoza wskazała na
zaległe migracje na zdalnej bazie — to osobna sprawa, prowadzona we własnej
sesji i **nieobjęta tą zmianą**. Tu zostaje wyłącznie obserwacja poboczna:
gdy zapis pada, `POST /api/cards` zwraca komunikat, z którego ani user, ani
operator nie ma jak dojść do przyczyny.

**Uwaga o trybie pracy.** Ta zmiana została zaimplementowana i zweryfikowana
_przed_ założeniem folderu — jako mała poprawka w toku pracy nad M3L3.
Folder zakłada się po fakcie, na wyraźną prośbę użytkownika, żeby zmiana
trafiła do archiwum na równi z pozostałymi. `plan.md` jest więc **zapisem
wykonanej pracy, nie planem, który nią kierował** — i jest tak oznaczony.
Nie powstał `research.md` ani `frame.md`; kontrakt do obrony był już
zapisany w istniejącym teście hermetycznym i w §6.3 cookbooka.
