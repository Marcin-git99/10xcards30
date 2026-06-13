# LANE A — F-02 google-oauth-switch

> Notatka koordynacyjna pracy równoległej (m2l5). Worktree izoluje git, NIE środowisko.
> Dispatcher: `D:\projekty\10xCards`. Lane równoległy: B = `flashcard-library` (S-03).

## Tożsamość pasa

- **Branch:** `feature/google-oauth-switch`
- **Plan:** `context/changes/google-oauth-switch/plan.md` (3 fazy, gotowy)
- **Tryb:** interaktywny — F-02 ma kroki manualne (Google Console, deploy).

## Reguły koordynacji środowiska (NIE łam)

- **Port dev:** ten pas posiada domyślny **4321**. (Lane B używa 4322.)
- **Supabase lifecycle:** ten pas jest właścicielem `npx supabase stop && npx supabase start`
  (potrzebne dla `supabase/config.toml` — provider Google). Rób restart, gdy lane B NIE pisze do bazy.
- **Wspólna lokalna baza** (`localhost:54321/54322`) — jeden Docker dla obu pasów.
  Ten pas **nie dodaje migracji** (plan: „No DB/schema/RLS changes").
- **Pliki współdzielone:** ten pas **jest właścicielem** edycji `src/middleware.ts` (bounce)
  i `src/components/Topbar.astro` (usunięcie linku signup). Lane B ma ich NIE ruszać.

## Kroki manualne (należą do Ciebie, nie do agenta)

- Google Cloud Console: OAuth client „Web application" + redirect URI Supabase.
- Supabase dashboard: włącz provider Google (Client ID + Secret).
- Sekret lokalnie: zmienna env czytana przez CLI (NIE `.dev.vars`).
- Deploy + weryfikacja na workerd (faza 3).

## Po skończeniu

Solo Code Review (`/code-review`) → osobny PR z tego brancha.
