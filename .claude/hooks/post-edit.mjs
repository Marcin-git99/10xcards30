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
 * Zapisany escape'em, nie dosłownym znakiem: dosłowny U+FEFF jest niewidoczny
 * w diffie i łamie regułę `no-irregular-whitespace` (przekonaliśmy się o tym
 * dopiero wtedy, gdy `npm run lint` przestał przechodzić).
 */
const BOM = "\uFEFF";

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
 * Predykat składa się z dwóch list, bo miesza dwie różne rzeczy i mylenie ich
 * prowadzi do złych decyzji (autor tego pliku pomylił je dwa razy, zanim
 * sprawdził empirycznie):
 *
 *   RISK_PATHS  — GDZIE mieszka ryzyko. Wynika z §2 test-planu, jest stabilne,
 *                 nie zmienia się, gdy dochodzą testy.
 *   NO_TESTS_YET — gdzie `vitest related` znalazłby DZIŚ zero plików. To stan
 *                 przejściowy: kurczy się z każdą fazą rolloutu.
 *
 * Świadomie poza `RISK_PATHS`: `src/components/ui/**` (kod shadcn/ui, testowany
 * u źródła — §7), `src/styles/**` i `.astro` warstwy prezentacji (§7 wyklucza
 * testy wyglądu), `test/**` (edycja testu odpalałaby test napisany przed
 * chwilą — to echo, nie sygnał).
 */

/** Gdzie mieszka ryzyko (test-plan.md §2). Stabilne. */
const RISK_PATHS = [
  "src/pages/api/", // Ryzyko #2 (wyciek wnętrzności), #4 (dane usera A u usera B)
  "src/middleware.ts", // Ryzyko #3 (dostęp bez ważnej sesji) — bramkuje wszystkie chronione trasy naraz
  "src/lib/supabase.ts", // Ryzyko #1 (sesja i ciasteczka) — fabryka klienta
  "src/lib/api-error.ts", // Ryzyko #2 — polityka redakcji błędów
];

/**
 * Ścieżki objęte ryzykiem, które NIE MAJĄ dziś powiązanych testów. `vitest
 * related` zwróciłby „No test files found" po ~13 s — zero sygnału za pełną
 * cenę, czyli dokładnie to, czego zabrania §1 („koszt × sygnał").
 *
 * Sprawdzone empirycznie 2026-08-06. **Usuwaj stąd wpisy, gdy kolejne fazy
 * rolloutu dołożą testy** — to jedyna lista, którą trzeba tu ruszać:
 *   - `src/middleware.ts` → Faza 2 rolloutu (bramka wejścia, Ryzyko #3)
 *   - `src/pages/api/auth/` → Faza 2; przepisuje je też F-02 (Google OAuth)
 */
const NO_TESTS_YET = ["src/middleware.ts", "src/pages/api/auth/"];

/**
 * @param {string} relPath ścieżka względem korzenia repo, POSIX-owa
 * @returns {boolean} true → hook dopłaca ~13 s na `vitest related`
 */
function isRiskArea(relPath) {
  if (relPath.startsWith("src/components/ui/")) return false;
  if (NO_TESTS_YET.some((prefix) => relPath.startsWith(prefix))) return false;

  return RISK_PATHS.some((prefix) => relPath.startsWith(prefix));
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
    // Niektóre powłoki (PowerShell) doklejają BOM na początku pipe'a. Zapis
    // przez escape, nie dosłownym znakiem: dosłowny jest niewidoczny w diffie
    // i łamie regułę no-irregular-whitespace.
    const raw = readFileSync(0, "utf8");
    event = JSON.parse(raw.startsWith(BOM) ? raw.slice(1) : raw);
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
