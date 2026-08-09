import { test as setup, expect } from "@playwright/test";
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

  const user = await createTestUser("session");
  saveTestUser(user);

  await context.addCookies(await sessionCookies(user, origin));

  // Dowód, że wstrzyknięta sesja jest prawdziwa dla aplikacji: middleware
  // przepuszcza na chronioną trasę zamiast odbić na /auth/signin.
  // Asercja na stan końcowy, nie na kod odpowiedzi (test-plan.md §2, Ryzyko 1).
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await context.storageState({ path: STORAGE_STATE });
});
