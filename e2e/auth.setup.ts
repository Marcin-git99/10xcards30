import { test as setup, expect } from "@playwright/test";
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

  // Warstwa HTTP jest już rozgrzana i sprawdzona: `e2e/global-setup.ts`
  // wymusza trzy czyste przejścia po każdej trasie (łącznie z `302` dla
  // anonima na trasach chronionych), zanim Playwright dopuści ten projekt.
  // Tutaj zostaje wyłącznie to, czego nie da się rozgrzać bez sesji i bez
  // przeglądarki: hydratacja wysp i uwierzytelniona ścieżka `POST /api/cards`.
  const user = await createTestUser("session");
  saveTestUser(user);

  await context.addCookies(await sessionCookies(user, origin));

  // Dowód, że wstrzyknięta sesja jest prawdziwa dla aplikacji: middleware
  // przepuszcza na chronioną trasę zamiast odbić na /auth/signin.
  // Asercja na stan końcowy, nie na kod odpowiedzi (test-plan.md §2, Ryzyko 1).
  //
  // Komunikat, bo ta jedna asercja pada też z powodu, który nie ma nic
  // wspólnego z sesją: aplikacja zbudowana BEZ konfiguracji Supabase odbija
  // wszystkich tak samo. `astro preview` idzie przez workerd, a worker nie
  // dziedziczy `process.env` — czyta wyłącznie `.dev.vars` skopiowane do
  // `dist/server/` przy buildzie. Zweryfikowane eksperymentalnie: sam
  // `SUPABASE_URL`/`SUPABASE_KEY` w powłoce nie wystarcza, suite pada dokładnie
  // tutaj. Bez tej wskazówki brak konfiguracji runnera wygląda na regresję sesji.
  await page.goto("/dashboard");
  await expect(
    page,
    "sesja wstrzyknięta, a middleware i tak odbija — sprawdź, czy aplikacja została zbudowana z SUPABASE_URL/SUPABASE_KEY (lokalnie `.dev.vars`, na CI krok „Skonfiguruj runtime aplikacji”)",
  ).toHaveURL(/\/dashboard$/);
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
