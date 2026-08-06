import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SUPABASE_KEY } from "astro:env/server";

/**
 * Ryzyko #2, twarz druga: sekret w bundlu front-endu.
 *
 * `astro.config.mjs` deklaruje SUPABASE_URL/SUPABASE_KEY jako
 * `context: "server", access: "secret"`. Ten test pilnuje SKUTKU tej
 * deklaracji, a nie jej obecności w konfiguracji — konfigurację można zmienić
 * bez zauważenia, wyciek w artefakcie jest już nieodwracalny.
 *
 * CEL TO `dist/client/**`, NIE CAŁE `dist/`. Produkcyjny `SUPABASE_KEY` jest
 * legalnie obecny w `dist/server/.dev.vars` — adapter Cloudflare kopiuje tam
 * ten plik. `dist/server` nie jest publikowany, bo adapter nadpisuje
 * `assets.directory` na `../client` (zweryfikowane na wdrożonym środowisku:
 * /server/.dev.vars → 404). Asercja na całym `dist/` byłaby fałszywie czerwona
 * i pierwsza osoba, która ją zobaczy, słusznie by ją wyciszyła.
 */

const CLIENT_DIR = path.resolve("dist/client");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/**
 * Wartości, które w żadnym wypadku nie mogą trafić do bundla. Zbierane z
 * wielu źródeł, bo build lokalny czyta `.dev.vars`, a CI dostaje sekrety przez
 * zmienne środowiskowe — test musi łapać wyciek niezależnie od tego, czym
 * zbudowano artefakt.
 */
function secretsToHuntFor(): string[] {
  const candidates: (string | undefined)[] = [SUPABASE_KEY];

  for (const file of [".dev.vars", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (line.startsWith("#") || !line.includes("=")) continue;
      const [name, ...rest] = line.split("=");
      if (name.trim().endsWith("SUPABASE_KEY")) candidates.push(rest.join("=").trim());
    }
  }

  // Krótkie/puste wartości pomijamy — szukanie ich w bundlu dawałoby trafienia
  // przypadkowe.
  return [...new Set(candidates.filter((v): v is string => typeof v === "string" && v.length >= 20))];
}

describe("artefakt builda nie zawiera sekretów", () => {
  // Bez tego strażnika cały plik przechodzi trywialnie, gdy nikt nie zbudował
  // projektu — a zielona bramka bezpieczeństwa, która niczego nie sprawdziła,
  // jest gorsza niż jej brak.
  it("wymaga istniejącego artefaktu klienta", () => {
    expect(
      existsSync(CLIENT_DIR),
      `Brak ${CLIENT_DIR}. Uruchom \`npm run build\` przed \`npm run test:hermetic\` — ta bramka nie ma czego sprawdzić.`,
    ).toBe(true);
  });

  it("nie zawiera wartości SUPABASE_KEY w żadnym pliku klienta", () => {
    const secrets = secretsToHuntFor();
    expect(secrets.length, "nie udało się ustalić żadnej wartości SUPABASE_KEY do sprawdzenia").toBeGreaterThan(0);

    const leaks: string[] = [];
    for (const file of walk(CLIENT_DIR)) {
      let content: string;
      try {
        content = readFileSync(file, "utf8");
      } catch {
        continue; // plik binarny — sekret tekstowy i tak by się nie ukrył
      }
      if (secrets.some((secret) => content.includes(secret))) {
        leaks.push(path.relative(CLIENT_DIR, file));
      }
    }

    expect(leaks, `sekret znaleziony w publikowanych plikach: ${leaks.join(", ")}`).toEqual([]);
  });

  it("nie zawiera plików ze zmiennymi środowiskowymi", () => {
    const forbidden = walk(CLIENT_DIR)
      .map((file) => path.basename(file))
      .filter((name) => name === ".dev.vars" || name === ".env" || name.startsWith(".env."));

    expect(forbidden).toEqual([]);
  });
});
