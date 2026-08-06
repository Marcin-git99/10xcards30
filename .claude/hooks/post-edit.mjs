#!/usr/bin/env node
/**
 * PostToolUse hook — warstwa per-edit lokalnego modelu jakości.
 *
 * Kontrakt (docs: code.claude.com/docs/en/hooks):
 *   stdin  — JSON zdarzenia; ścieżka edytowanego pliku w `tool_input.file_path`
 *   exit 0 — cicho, wszystko przeszło
 *   exit 2 — stderr trafia do kontekstu agenta jako feedback (PostToolUse NIE
 *            blokuje narzędzia — edycja już się wykonała; to kanał zwrotny,
 *            nie hamulec)
 *   inne   — błąd nieblokujący; ląduje w transkrypcie, nie przerywa pracy
 *
 * Dlaczego akurat te dwie kontrole (zmierzone na tej maszynie, 2026-08-06):
 *   prettier na jednym pliku          0,7 s  → stać nas przy każdej edycji
 *   eslint na jednym pliku           15,0 s  → za drogo, zostaje na pre-commit
 *   vitest related --run             12,4 s  → tylko dla plików z obszaru ryzyka
 *   astro check                      31,9 s  → pre-push
 *
 * Uwaga o `vitest related`: nie jest tu szybszy od całej suity hermetycznej
 * (11,7 s) — 11 z tych sekund to stały narzut startu Vite + getViteConfig().
 * Zostaje, bo daje coś innego niż szybkość: testy z test/integration/ nie
 * importują modułów route'ów (walą prosto w PostgREST), więc `related` nigdy
 * ich nie wciągnie i hook nie zażąda działającego Supabase.
 *
 * Binarki odpalamy przez process.execPath prosto z node_modules — `npx`
 * dokładał ~2 s do każdego uruchomienia.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

/** Rozszerzenia, które prettier w tym repo faktycznie obsługuje (por. lint-staged w package.json). */
const FORMATTABLE = new Set([".ts", ".tsx", ".astro", ".json", ".css", ".md", ".mjs", ".js", ".jsx"]);

/** Katalogi generowane albo cudze — hook nie ma tam czego szukać. */
const SKIP_DIRS = ["node_modules/", "dist/", ".astro/", ".git/", "supabase/.temp/"];

/**
 * Czy edytowany plik należy do obszaru ryzyka, który zasługuje na testy przy
 * każdej edycji?
 *
 * To jest jedyna decyzja w tym pliku, która nie wynika z pomiaru czasu, tylko z
 * oceny ryzyka — dlatego wyrocznią jest `context/foundation/test-plan.md §2`,
 * a nie intuicja co do tego, "gdzie bywają błędy".
 *
 * Wejście: ścieżka względem korzenia repo, w formie POSIX-owej,
 *          np. "src/pages/api/cards.ts" albo "src/components/ui/button.tsx".
 * Wyjście: true → hook dopłaca 12 s na `vitest related` dla tego pliku.
 *
 * Do rozważenia przy pisaniu warunku:
 *   - Ryzyko #2 (wyciek wnętrzności systemu) i #4 (dane usera A widoczne dla
 *     usera B) mają dziś realne testy — i oba mieszkają w warstwie API.
 *   - Ryzyko #3 (dostęp bez sesji) przechodzi przez `src/middleware.ts`, który
 *     nie jest endpointem, a bramkuje wszystkie chronione trasy naraz.
 *   - `src/lib/supabase.ts` to fabryka klienta — to on decyduje o kształcie
 *     ciasteczek i sesji (Ryzyko #1, §6.6 „fragmenty ciasteczek…").
 *   - Kontrargument wart rozważenia: pliki w `test/` przy edycji też mogłyby
 *     odpalać własne testy. Tanio, ale czy to sygnał, czy tylko echo?
 *   - Czego świadomie NIE obejmować: `src/components/ui/**` (kod shadcn/ui,
 *     testowany u źródła — §7), `src/styles/**`, pliki `.astro` warstwy
 *     prezentacji (§7 wyklucza testy wyglądu).
 *
 * @param {string} relPath
 * @returns {boolean}
 */
function isRiskArea(relPath) {
  // TODO(Marcin): zdefiniuj predykat obszaru ryzyka na podstawie test-plan.md §2.
  // Dopóki zwraca false, hook robi wyłącznie formatowanie — jest bezpieczny,
  // po prostu nie odpala jeszcze testów.
  void relPath;
  return false;
}

/** Uruchamia binarkę z node_modules przez bieżący interpreter Node. */
function runNodeBin(relBinPath, args) {
  return spawnSync(process.execPath, [path.join(PROJECT_DIR, relBinPath), ...args], {
    cwd: PROJECT_DIR,
    encoding: "utf8",
    windowsHide: true,
  });
}

function main() {
  let event;
  try {
    // ﻿: niektóre powłoki (PowerShell) doklejają BOM na początku pipe'a.
    event = JSON.parse(readFileSync(0, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    // Kod ≠ 0 i ≠ 2 = błąd nieblokujący: widoczny w transkrypcie, ale niepodany
    // agentowi jako feedback o kodzie. Świadomie NIE wychodzimy tu zerem —
    // hook, który przy własnej awarii raportuje sukces, cicho przestaje
    // pilnować czegokolwiek i nikt się o tym nie dowiaduje.
    process.stderr.write(`post-edit hook: nie udało się odczytać zdarzenia ze stdin: ${String(err)}\n`);
    process.exit(1);
  }

  const absPath = event?.tool_input?.file_path;
  if (typeof absPath !== "string" || absPath.length === 0) process.exit(0);

  const relPath = path.relative(PROJECT_DIR, absPath).split(path.sep).join("/");

  // Plik spoza repo albo z katalogu generowanego — nic nie robimy.
  if (relPath.startsWith("..") || path.isAbsolute(relPath)) process.exit(0);
  if (SKIP_DIRS.some((dir) => relPath.startsWith(dir))) process.exit(0);

  const problems = [];

  // ── Warstwa 1: formatowanie (zawsze, gdy prettier rozumie plik) ────────────
  if (FORMATTABLE.has(path.extname(relPath))) {
    const fmt = runNodeBin("node_modules/prettier/bin/prettier.cjs", ["--write", "--ignore-unknown", relPath]);
    if (fmt.status !== 0) {
      // Najczęściej: błąd składni, przez który parser prettiera się wykłada.
      // To realny sygnał dla agenta — plik jest niepoprawny składniowo.
      problems.push(`prettier nie sformatował ${relPath}:\n${(fmt.stderr || fmt.stdout || "").trim()}`);
    }
  }

  // ── Warstwa 2: testy powiązane, wyłącznie dla obszarów ryzyka ─────────────
  if (isRiskArea(relPath)) {
    const tests = runNodeBin("node_modules/vitest/vitest.mjs", ["related", relPath, "--run", "--reporter=dot"]);
    if (tests.status !== 0) {
      problems.push(
        `testy powiązane z ${relPath} nie przechodzą:\n${(tests.stdout || "").trim()}\n${(tests.stderr || "").trim()}`,
      );
    }
  }

  if (problems.length > 0) {
    // Exit 2: stderr ląduje w kontekście agenta. Konkretny komunikat — nazwa
    // brakującego typu, nieprzeszła asercja — jest tym, co pozwala poprawić
    // błąd w następnej turze zamiast czekać na commit.
    process.stderr.write(problems.join("\n\n") + "\n");
    process.exit(2);
  }

  process.exit(0);
}

main();
