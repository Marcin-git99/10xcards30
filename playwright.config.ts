import { defineConfig, devices } from "@playwright/test";
import process from "node:process";
import { STORAGE_STATE } from "./e2e/helpers/test-user";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4321";
const PORT = new URL(BASE_URL).port || "4321";

export default defineConfig({
  testDir: "./e2e",
  // Testy muszą być niezależne — równoległość jest tu regułą wymuszającą, nie
  // optymalizacją. Test zakładający kolejność padnie tutaj od razu.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  // Dev server Astro kompiluje trasy API przy pierwszym trafieniu — zmierzone
  // 2,4 s dla `POST /api/cards`, a pierwszy strzał po starcie bywa wolniejszy.
  // Domyślne 5 s dawało losowe czerwienie. To nie jest `waitForTimeout`:
  // asercje nadal czekają na STAN i kończą, gdy tylko nastąpi — rośnie tylko
  // górny budżet.
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

  webServer: {
    // Port jawnie z BASE_URL — inaczej `astro dev` wstaje na 4321 niezależnie
    // od tego, na co celuje Playwright.
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    // Lokalnie podłącz się do już działającego `npm run dev`; na CI zawsze
    // startuj własny, żeby przebieg nie zależał od cudzego procesu.
    //
    // UWAGA przy weryfikacji przez celowe psucie: cudzy dev server (np. z innej
    // sesji) potrafi trzymać stary moduł `src/middleware.ts` i wtedy zepsucie
    // nie dociera do aplikacji — test zostaje zielony i fałszywie wygląda na
    // pozbawiony zębów. Wymuś wtedy świeży proces na osobnym porcie:
    //   $env:E2E_BASE_URL="http://localhost:4322"; npx playwright test
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
