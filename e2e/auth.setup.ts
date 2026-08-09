import { test as setup, expect, request as playwrightRequest } from "@playwright/test";
import { waitForIslandsHydrated } from "./helpers/island";
import { STORAGE_STATE, createTestUser, saveTestUser, sessionCookies } from "./helpers/test-user";

/**
 * Projekt `setup` — wykonuje się raz przed resztą suite'u (zależność w
 * `playwright.config.ts`). Zakłada świeże konto, wstrzykuje jego sesję do
 * kontekstu przeglądarki i zapisuje stan do `playwright/.auth/user.json`.
 *
 * Świeże konto na każdy przebieg zamiast jednego stałego: przebiegi nie
 * dziedziczą po sobie danych, więc suite jest odporny na powtórne
 * uruchomienie (test-plan.md §6.2 — izolacja przez osobne tożsamości).
 */
setup("authenticate", async ({ context, page, baseURL }) => {
  const origin = baseURL ?? "http://localhost:4321";

  // ── Warunek wstępny: bramka auth naprawdę żyje ─────────────────────────
  // `webServer` Playwrighta uznaje serwer za gotowy, gdy dostanie JAKĄKOLWIEK
  // odpowiedź z `/`. Zmierzone na zimnym starcie: przez pierwsze ~2 s
  // `astro dev` odpowiada, ale middleware jeszcze nie jest podpięte — żądanie
  // anonimowe o `/library` NIE dostaje wtedy przekierowania. Testy startujące
  // w tym oknie widziały anonima na chronionym ekranie i zgłaszały
  // materializację Ryzyka 3, której nie było.
  //
  // Czekamy na POPRAWNOŚĆ PROTOKOŁU, nie na konkretny kod. W oknie startowym
  // serwer zwracał status `0` — odpowiedź, która nie jest prawidłowym HTTP.
  // Każdy prawidłowy status oznacza, że okno się zamknęło.
  //
  // Świadomie NIE sprawdzamy tu `302`, mimo że to kusi: sonda pilnowałaby
  // wtedy tego samego, co `e2e/auth-gate.spec.ts`, więc osłabienie
  // `PROTECTED_ROUTES` wywracałoby setup zamiast jednego testu — a `lessons.md`
  // wymaga mutacji zabijającej dokładnie jeden test. To warunek wstępny
  // ŚRODOWISKA; o Ryzyku 3 orzeka wyłącznie auth-gate.spec.ts.
  const probe = await playwrightRequest.newContext({ baseURL: origin });
  try {
    await expect
      .poll(async () => (await probe.get("/library", { maxRedirects: 0 })).status(), {
        timeout: 90_000,
        message: "dev server nie zwraca jeszcze prawidłowych odpowiedzi HTTP dla /library",
      })
      .toBeGreaterThanOrEqual(200);
  } finally {
    await probe.dispose();
  }

  const user = await createTestUser("session");
  saveTestUser(user);

  await context.addCookies(await sessionCookies(user, origin));

  // Dowód, że wstrzyknięta sesja jest prawdziwa dla aplikacji: middleware
  // przepuszcza na chronioną trasę zamiast odbić na /auth/signin.
  // Asercja na stan końcowy, nie na kod odpowiedzi (test-plan.md §2, Ryzyko 1).
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // Rozgrzewka: zapłać tu za zimną kompilację, nie w testach.
  //
  // Dev server Astro kompiluje trasy i bundle wysp dopiero na żądanie. Gdy
  // robiły to same testy — równolegle, kilka workerów przeciw jednemu
  // serwerowi — hydratacja przekraczała 15 s i dawała flake zależny wyłącznie
  // od tego, czy serwer był już rozgrzany. Ten projekt biegnie sam i przed
  // resztą, więc jest właściwym miejscem na ten koszt. Hojny budżet dotyczy
  // wyłącznie tej jednej, zimnej ścieżki.
  await waitForIslandsHydrated(page, 90_000);

  await page.goto("/library");
  await expect(page.getByRole("heading", { name: /Moje fiszki/ })).toBeVisible();
  await waitForIslandsHydrated(page, 90_000);

  await context.storageState({ path: STORAGE_STATE });
});
