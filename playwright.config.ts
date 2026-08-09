import { defineConfig, devices } from "@playwright/test";
import process from "node:process";
import { STORAGE_STATE } from "./e2e/helpers/test-user";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4321";
const PORT = new URL(BASE_URL).port || "4321";

// Domyślnie suite idzie przeciw ZBUDOWANEJ aplikacji. `E2E_DEV=1` przełącza na
// dev server — szybsza pętla przy pisaniu testów, ale patrz komentarz przy
// `webServer` na temat tego, co ta wygoda kosztuje.
const USE_DEV_SERVER = process.env.E2E_DEV === "1";

export default defineConfig({
  testDir: "./e2e",
  // Testy muszą być niezależne — równoległość jest tu regułą wymuszającą, nie
  // optymalizacją. Test zakładający kolejność padnie tutaj od razu.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  // Dev server Astro kompiluje trasy na żądanie, a `webServer` czeka tylko na
  // odpowiedź z `/` — więc pierwszy przebieg po zmianie kodu płaci za
  // kompilację `/dashboard`, `/library` i `/auth/signin` w trakcie testów.
  // Zmierzone: 2,4 s dla samego `POST /api/cards`, a zimny przebieg całości
  // przekraczał domyślne 30 s na test i 5 s na asercję — dawało to flake
  // zależny wyłącznie od tego, czy serwer był już rozgrzany.
  //
  // To NIE jest `waitForTimeout`: asercje nadal czekają na STAN i kończą, gdy
  // tylko nastąpi. Rośnie wyłącznie górny budżet cierpliwości.
  //
  // Na CI ten koszt znika, jeśli suite pójdzie przeciw zbudowanej aplikacji
  // (`astro build && astro preview`) zamiast przeciw dev serverowi.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],

  // Dlaczego domyślnie build+preview, a nie `astro dev`.
  //
  // `astro dev` kompiluje trasy, middleware i bundle wysp DOPIERO na żądanie.
  // To dało trzy niezależne, przerywane awarie, żadną niezwiązaną z badanymi
  // ryzykami: (1) anonim dosięgał /library w oknie ~2 s, zanim middleware
  // zostało podpięte; (2) hydratacja przekraczała budżet pod kontencją dwóch
  // workerów; (3) pierwsze trafienie w trasę API kosztowało 2,4 s. Zmierzone
  // na dev serverze: 6 zielonych / 2 czerwone z 8 zimnych przebiegów.
  //
  // Przeciw zbudowanej aplikacji nie ma czego kompilować w trakcie testów, więc
  // cała ta klasa znika u źródła. Koszt: build przed przebiegiem. To bramka
  // uruchamiana przed merge, nie przy każdej edycji — ten koszt jest do
  // przyjęcia, a niestabilny suite nie jest.
  //
  // `E2E_DEV=1` wraca na dev server (szybsza pętla przy PISANIU testów).
  // Nie ufaj wtedy pojedynczej zieleni ani pojedynczej czerwieni.
  webServer: {
    // Port jawnie z BASE_URL — inaczej serwer wstaje na 4321 niezależnie od
    // tego, na co celuje Playwright.
    command: USE_DEV_SERVER ? `npm run dev -- --port ${PORT}` : `npm run build && npm run preview -- --port ${PORT}`,
    url: BASE_URL,
    // Przy buildzie NIGDY nie podłączaj się do cudzego procesu: zastany serwer
    // serwuje starą kompilację, więc zmiany w kodzie po cichu nie docierają do
    // testów. Przejechaliśmy to na dev serverze z innej sesji — celowe psucie
    // `src/middleware.ts` nie dotarło do aplikacji, test został zielony i
    // fałszywie wyglądał na pozbawiony zębów.
    reuseExistingServer: USE_DEV_SERVER && !process.env.CI,
    timeout: 300_000,
  },
});
