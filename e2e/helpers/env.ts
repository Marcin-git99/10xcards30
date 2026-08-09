import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * Ładuje `.env.test` do `process.env` na potrzeby testów E2E.
 *
 * Playwright uruchamia się poza Astro, więc nie ma tu `astro:env/server` —
 * zmienne trzeba wczytać ręcznie. `process.env` wygrywa z plikiem, dokładnie
 * jak pod Vitest (patrz test-plan.md §6.6), więc zabłąkana zmienna w powłoce
 * nadal przekierowałaby przebieg — dlatego guard poniżej czyta wartość
 * *efektywną*, a nie zawartość pliku.
 */
export function loadTestEnv(): { supabaseUrl: string; supabaseKey: string } {
  const file = path.resolve(process.cwd(), ".env.test");

  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const supabaseKey = process.env.SUPABASE_KEY ?? "";

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Brak SUPABASE_URL/SUPABASE_KEY dla testów E2E. Uzupełnij `.env.test` " +
        "(wartości z `npx supabase status -o env`).",
    );
  }

  // Ten sam guard co `test/setup.ts`: testy zakładają konta i piszą wiersze,
  // więc przebieg przeciw zdalnemu projektowi jest zawsze błędem.
  const host = new URL(supabaseUrl).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(
      `Testy E2E odmawiają startu: SUPABASE_URL wskazuje na "${host}", nie na localhost. ` +
        "Te testy zakładają konta i zapisują dane — nigdy nie uruchamiaj ich przeciw zdalnemu projektowi.",
    );
  }

  return { supabaseUrl, supabaseKey };
}
