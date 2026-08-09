import { test as setup, expect, request as playwrightRequest } from "@playwright/test";
import { waitForIslandsHydrated } from "./helpers/island";
import { STORAGE_STATE, authenticatedClient, createTestUser, saveTestUser, sessionCookies } from "./helpers/test-user";

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
  // Sondujemy `/dashboard`, a NIE `/library`, i czekamy właśnie na `302`.
  //
  // Dlaczego akurat tak. Słabszy warunek („jakikolwiek prawidłowy status")
  // nie wystarcza: w oknie startowym `/library` potrafi zwrócić `200`, czyli
  // stronę wyrenderowaną bez middleware — sonda przyjęłaby jako „gotowe"
  // dokładnie ten stan, który jest awarią.
  //
  // Dlaczego to nie duplikuje `auth-gate.spec.ts`: obie trasy chroni to samo
  // middleware, ale mutacja użyta przy celowym psuciu Ryzyka 3 osłabia bramkę
  // dla `/library` i zostawia `/dashboard` nietknięte. Sonda dowodzi więc, że
  // middleware ŻYJE, nie orzekając o konfiguracji trasy pod testem — mutacja
  // nadal zabija dokładnie jeden test, jak wymaga `lessons.md`.
  const probe = await playwrightRequest.newContext({ baseURL: origin });
  try {
    await expect
      .poll(async () => (await probe.get("/dashboard", { maxRedirects: 0 })).status(), {
        timeout: 90_000,
        message:
          "middleware nie odbija jeszcze anonimowych żądań z /dashboard — serwer zimny albo bramka auth rozkonfigurowana",
      })
      .toBe(302);

    // Rozgrzewka pozostałych tras anonimowych, na które wchodzi
    // `auth-gate.spec.ts`: odbicie z /library i strona docelowa odbicia.
    // Sonda wyżej pilnuje /dashboard, więc te dwie trzeba rozgrzać osobno.
    await probe.get("/library", { maxRedirects: 0 });
    await probe.get("/auth/signin");
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

  // Rozgrzewka trasy API. `page.request` dziedziczy ciasteczka kontekstu, więc
  // to jest ta sama, uwierzytelniona ścieżka, którą idzie `CreateCardForm`.
  // Pierwsze trafienie w zimną trasę kosztowało tyle, że fiszka nie zdążyła
  // pojawić się na liście w budżecie testu — objaw „element(s) not found",
  // wyglądający na utratę danych, a będący kosztem zimnego startu.
  const warmupQuestion = `E2E warmup ${Date.now()}`;
  const warmup = await page.request.post("/api/cards", {
    data: { question: warmupQuestion, answer: "rozgrzewka" },
  });
  expect(warmup.status(), "rozgrzewka POST /api/cards").toBe(201);

  // Fiszka rozgrzewkowa nie może zostać — testy asertują na zawartość list.
  const cleaner = await authenticatedClient(user);
  const { error: cleanupError } = await cleaner.from("cards").delete().like("question", "E2E warmup %");
  expect(cleanupError?.message, "sprzątanie fiszki rozgrzewkowej").toBeUndefined();

  await context.storageState({ path: STORAGE_STATE });
});
