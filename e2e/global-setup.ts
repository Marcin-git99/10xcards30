import process from "node:process";
import { request, type FullConfig } from "@playwright/test";

/**
 * Bramka gotowości serwera — jedyne miejsce, które decyduje, czy Playwright
 * w ogóle dopuści testy do aplikacji.
 *
 * Dlaczego to istnieje, skoro `webServer` już czeka na serwer.
 * `webServer` uznaje serwer za gotowy, gdy dostanie JAKĄKOLWIEK odpowiedź z
 * `url`. Zmierzone na tej aplikacji: proces otwiera port, zanim jest zdolny
 * obsłużyć żądanie — pierwsze trafienia wracają jako status `0` (odpowiedź
 * niebędąca prawidłowym HTTP), a chwilę później trasy odpowiadają, ale bez
 * podpiętego middleware, więc `/library` potrafi zwrócić `200` anonimowi.
 * To było jedyne źródło niestabilności tej warstwy (test-plan.md §6.7):
 * świeży serwer 6/8 i 3/4, rozgrzany 10/10.
 *
 * Kolejność jest tu całą pointą. Playwright uruchamia plugin `webServer`
 * PRZED `globalSetup` (`createGlobalSetupTasks` w runnerze: najpierw
 * `createPluginSetupTasks`, dopiero potem pliki `globalSetup`), a projekt
 * `setup` — jak każdy projekt — startuje po `globalSetup`. Ten plik jest więc
 * jedynym punktem, w którym można odrzucić serwer, zanim którykolwiek test
 * (łącznie z `auth.setup.ts`) zdąży zobaczyć go w stanie przejściowym.
 *
 * Podział pracy z `e2e/auth.setup.ts`: tutaj rozgrzewamy warstwę HTTP —
 * anonimowo, bez przeglądarki, bo tyle wystarczy, by wymusić kompilację trasy
 * i podpięcie middleware. Rozgrzewka hydratacji wysp i uwierzytelnionej
 * ścieżki `POST /api/cards` zostaje w `auth.setup.ts`, bo wymaga sesji i
 * kontekstu przeglądarki.
 */

interface RouteContract {
  method: "GET" | "POST";
  path: string;
  /** Status, który ta trasa musi zwrócić żądaniu BEZ sesji. */
  expected: number;
  /** Co dowodzi tej jednej sondy — trafia do komunikatu przy przekroczeniu budżetu. */
  proves: string;
}

/**
 * Kontrakty anonimowe dla każdej trasy, której dotyka suite.
 *
 * Statusy są celowo dokładne, nie „jakikolwiek prawidłowy". Słabszy warunek
 * przyjąłby jako „gotowe" dokładnie ten stan, który jest awarią: `/library`
 * odpowiadające `200` bez sesji to nie rozgrzana trasa, tylko brak bramki.
 *
 * Dokładając test dotykający nowej trasy — dopisz ją tutaj (test-plan.md §6.7).
 */
const CONTRACTS: RouteContract[] = [
  { method: "GET", path: "/", expected: 200, proves: "serwer renderuje stronę publiczną" },
  { method: "GET", path: "/auth/signin", expected: 200, proves: "cel odbicia z bramki auth istnieje" },
  { method: "GET", path: "/dashboard", expected: 302, proves: "middleware odbija anonima z trasy chronionej" },
  { method: "GET", path: "/library", expected: 302, proves: "middleware odbija anonima z drugiej trasy chronionej" },
  { method: "POST", path: "/api/cards", expected: 401, proves: "trasa API skompilowana i zamknięta dla anonima" },
];

/**
 * Ile pełnych, bezbłędnych przejść po wszystkich trasach uznajemy za gotowość.
 *
 * Jedno przejście nie wystarcza: okno startowe jest niejednorodne — trasa
 * potrafi odpowiedzieć poprawnie i przy następnym trafieniu znów wrócić
 * błędem, bo kolejne warstwy procesu wstają niezależnie. Warunkiem jest więc
 * seria: trzy przejścia z rzędu, w których KAŻDA trasa dotrzymała kontraktu.
 * Pojedyncze potknięcie w dowolnej trasie zeruje licznik, a nie tylko cofa go
 * o jeden.
 *
 * Trzy przejścia to 15 żądań; na rozgrzanym serwerze koszt jest poniżej
 * progu zauważalności, a to jedyny moment w całym przebiegu, w którym za
 * cierpliwość płacimy raz zamiast w każdym teście z osobna.
 */
const REQUIRED_CLEAN_PASSES = 3;
const PASS_INTERVAL_MS = 200;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Górny budżet czekania. To NIE jest `waitForTimeout` — pętla kończy się w
 * momencie osiągnięcia stanu, budżet ogranicza wyłącznie cierpliwość. Hojny,
 * bo w CI po tej samej stronie stoi zimny build i runner bez cache.
 */
const READY_TIMEOUT_MS = Number(process.env.E2E_READY_TIMEOUT_MS ?? 120_000);

interface RouteStats {
  attempts: number;
  /** Statusy inne niż oczekiwany, z licznikiem — to jest dowód istnienia okna startowego. */
  unexpected: Map<number, number>;
  /** Żądania, które nie zwróciły prawidłowego HTTP (odpowiednik statusu `0`). */
  networkErrors: number;
  lastError?: string;
  /** Czas do PIERWSZEJ odpowiedzi zgodnej z kontraktem, w ms od startu bramki. */
  firstOkMs?: number;
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = process.env.E2E_BASE_URL ?? config.projects[0]?.use.baseURL ?? "http://localhost:4321";

  const context = await request.newContext({ baseURL });
  const startedAt = Date.now();
  const stats = new Map<string, RouteStats>();
  let cleanPasses = 0;

  try {
    while (cleanPasses < REQUIRED_CLEAN_PASSES) {
      let clean = true;

      for (const contract of CONTRACTS) {
        const ok = await probe(context, contract, stats, startedAt);
        if (!ok) clean = false;
      }

      cleanPasses = clean ? cleanPasses + 1 : 0;

      if (cleanPasses < REQUIRED_CLEAN_PASSES) {
        if (Date.now() - startedAt > READY_TIMEOUT_MS) {
          throw new Error(timeoutReport(baseURL, stats, startedAt));
        }
        await sleep(PASS_INTERVAL_MS);
      }
    }
  } finally {
    await context.dispose();
  }

  report(baseURL, stats, Date.now() - startedAt);
}

async function probe(
  context: Awaited<ReturnType<typeof request.newContext>>,
  contract: RouteContract,
  stats: Map<string, RouteStats>,
  startedAt: number,
): Promise<boolean> {
  const stat = statsFor(stats, contract);
  stat.attempts++;

  try {
    // `maxRedirects: 0` jest tu obowiązkowe: bez tego odbicie z trasy
    // chronionej zostałoby podążone i sonda zobaczyłaby `200` ze strony
    // logowania — czyli status wskazujący na sukces tam, gdzie kontraktem
    // jest właśnie przekierowanie.
    const options = { maxRedirects: 0, failOnStatusCode: false, timeout: REQUEST_TIMEOUT_MS };
    const response =
      contract.method === "POST"
        ? // Ciało jest atrapą i nigdy nie zostanie odczytane: `POST /api/cards`
          // sprawdza sesję przed parsowaniem, więc anonim dostaje 401 i sonda
          // nie zapisuje niczego do bazy.
          await context.post(contract.path, { ...options, data: {} })
        : await context.get(contract.path, options);

    if (response.status() === contract.expected) {
      stat.firstOkMs ??= Date.now() - startedAt;
      return true;
    }

    stat.unexpected.set(response.status(), (stat.unexpected.get(response.status()) ?? 0) + 1);
    return false;
  } catch (error) {
    // Wyjątek na poziomie sieci to odpowiednik obserwowanego statusu `0`:
    // port przyjmuje połączenie, ale proces nie potrafi jeszcze odpowiedzieć.
    stat.networkErrors++;
    stat.lastError = error instanceof Error ? error.message : String(error);
    return false;
  }
}

function statsFor(stats: Map<string, RouteStats>, contract: RouteContract): RouteStats {
  const key = routeKey(contract);
  const existing = stats.get(key);
  if (existing) return existing;

  const fresh: RouteStats = { attempts: 0, unexpected: new Map(), networkErrors: 0 };
  stats.set(key, fresh);
  return fresh;
}

const routeKey = (contract: RouteContract) => `${contract.method} ${contract.path}`;

/**
 * Raport gotowości. Nie jest ozdobą: liczba odrzuconych odpowiedzi to jedyny
 * bezpośredni dowód, że okno zimnego startu wystąpiło i że zostało pochłonięte
 * TUTAJ, a nie w teście. Zerowe liczniki na rozgrzanym serwerze i niezerowe na
 * zimnym są oczekiwane — patrz test-plan.md §6.7.
 */
function report(baseURL: string, stats: Map<string, RouteStats>, elapsedMs: number): void {
  const lines = [...stats.entries()].map(([key, stat]) => {
    const rejected = stat.networkErrors + [...stat.unexpected.values()].reduce((sum, n) => sum + n, 0);
    const detail = [
      stat.networkErrors > 0 ? `${stat.networkErrors}× brak prawidłowego HTTP` : null,
      ...[...stat.unexpected.entries()].map(([status, count]) => `${count}× ${status}`),
    ]
      .filter(Boolean)
      .join(", ");
    return `  ${key.padEnd(20)} pierwsza zgodna po ${stat.firstOkMs ?? 0} ms, odrzucono ${rejected}${detail ? ` (${detail})` : ""}`;
  });

  // eslint-disable-next-line no-console -- raport gotowości ma trafić do logu przebiegu (lokalnie i w CI)
  console.log(
    [`[e2e] serwer ${baseURL} gotowy po ${elapsedMs} ms (${REQUIRED_CLEAN_PASSES} czyste przejścia)`, ...lines].join(
      "\n",
    ),
  );
}

function timeoutReport(baseURL: string, stats: Map<string, RouteStats>, startedAt: number): string {
  const failing = CONTRACTS.filter((contract) => stats.get(routeKey(contract))?.firstOkMs === undefined).map(
    (contract) => {
      const stat = stats.get(routeKey(contract));
      const seen =
        stat && stat.unexpected.size > 0
          ? [...stat.unexpected.entries()].map(([status, count]) => `${count}× ${status}`).join(", ")
          : `${stat?.networkErrors ?? 0}× brak prawidłowego HTTP (${stat?.lastError ?? "bez szczegółów"})`;
      return `  ${routeKey(contract)} — oczekiwano ${contract.expected}, widziano: ${seen}\n    dowodzi: ${contract.proves}`;
    },
  );

  return [
    `Serwer ${baseURL} nie osiągnął stabilnych odpowiedzi w ${Date.now() - startedAt} ms.`,
    failing.length > 0
      ? `Trasy, które ani razu nie dotrzymały kontraktu:\n${failing.join("\n")}`
      : "Każda trasa odpowiedziała poprawnie co najmniej raz, ale nigdy trzy przejścia z rzędu — serwer odpowiada niestabilnie.",
    "To bramka gotowości, nie asercja produktu: albo serwer nie wstał, albo bramka auth jest rozkonfigurowana.",
  ].join("\n");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
