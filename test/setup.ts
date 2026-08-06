import { SUPABASE_URL } from "astro:env/server";

/**
 * Guard środowiskowy — ubija cały przebieg, jeśli suita celuje w cokolwiek
 * innego niż lokalny Supabase.
 *
 * Czyta `astro:env/server`, czyli DOKŁADNIE tę samą drogę, którą wartość
 * pobiera `src/lib/supabase.ts`. Sprawdzanie zawartości pliku `.env` byłoby
 * bezwartościowe: 2026-08-05 przez dwadzieścia minut dev server rozmawiał
 * z produkcją, mimo że oba pliki środowiska wskazywały localhost — adapter
 * Cloudflare wstrzyknął stare wartości do `process.env` przy starcie procesu,
 * a restart Vite ich nie wyczyścił.
 *
 * Guard jest twardy (rzuca zamiast pomijać testy), bo zielony przebieg
 * z cicho pominiętymi testami izolacji to fałszywy sygnał — dokładnie to,
 * czego zakazuje test-plan.md §1.
 */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function describeFix(seen: string): string {
  return [
    `Testy celują w ${seen}, a nie w lokalny Supabase.`,
    "",
    "Napraw tak:",
    "  1. Upewnij się, że .env.test ma SUPABASE_URL z `npx supabase status -o env` (API_URL).",
    "  2. Ubij proces runnera i uruchom go od nowa — restart w miejscu nie czyści process.env.",
    "  3. Sprawdź, czy w powłoce nie wisi $env:SUPABASE_URL z innej sesji.",
    "",
    "Guard istnieje, bo testy izolacji zakładają konta i piszą wiersze.",
    "Uruchomione przeciw produkcji zrobiłyby to na prawdziwych danych.",
  ].join("\n");
}

if (!SUPABASE_URL) {
  throw new Error(`[test guard] SUPABASE_URL jest puste.\n\n${describeFix("nigdzie (brak wartości)")}`);
}

let host: string;
try {
  host = new URL(SUPABASE_URL).hostname;
} catch {
  throw new Error(`[test guard] SUPABASE_URL nie jest poprawnym URL-em: ${SUPABASE_URL}`);
}

if (!LOCAL_HOSTS.has(host)) {
  throw new Error(`[test guard] ${describeFix(SUPABASE_URL)}`);
}
