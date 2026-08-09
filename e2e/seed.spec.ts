import { test, expect } from "@playwright/test";
import { waitForIslandsHydrated } from "./helpers/island";
import { authenticatedClient, readTestUser } from "./helpers/test-user";

/**
 * SEED TEST — wzorzec, z którego `/10x-e2e` modeluje każdy generowany test.
 *
 * Co pokażesz, to dostaniesz: jeśli tutaj pojawi się `page.waitForTimeout()`
 * albo selektor CSS, agent powieli to w każdym kolejnym teście. Ten plik jest
 * dźwignią jakości, nie formalnością.
 *
 * Cztery wzorce, które ten test ma demonstrować:
 *   1. Lokatory oparte na rolach   — `getByRole`, nigdy CSS/XPath.
 *   2. Niezależność testu          — własny setup, akcja, asercja, cleanup.
 *   3. Czekanie na stan, nie czas  — `toBeVisible()`, `waitForURL()`.
 *   4. Asercja powiązana z ryzykiem — nazwa testu wskazuje ryzyko z test-plan.md.
 *
 * Chronione ryzyko: **Ryzyko 1** z `context/foundation/test-plan.md` —
 * „user wypada z sesji po odświeżeniu strony". Kontrola z §Risk Response
 * Guidance: dowodem ochrony jest to, że user *pozostaje* na chronionym ekranie
 * po odświeżeniu, a nie kod odpowiedzi HTTP.
 *
 * Realne granice: middleware → routing → API `/api/cards` → Postgres z RLS.
 * Nic z tego nie jest mockowane — tam właśnie mieszka ryzyko integracyjne.
 * Sesja jest wstrzykiwana z pominięciem UI (patrz `helpers/test-user.ts`).
 */

// Unikalny identyfikator — dwa przebiegi obok siebie nie mogą się zderzyć.
// Brak UI do kasowania fiszek, więc unikalność jest pierwszą linią izolacji.
const uniqueQuestion = () => `E2E seed ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test("flashcard survives a page reload (Risk 1: session/data loss after refresh)", async ({ page }) => {
  const question = uniqueQuestion();
  const answer = "Odpowiedź seed testu";

  await page.goto("/dashboard");

  // Formularz jest wyspą React — do zakończenia hydratacji przyjmuje tekst do
  // DOM, ale nie do stanu komponentu. Bez tego czekania walidacja zobaczy
  // puste pola mimo widocznie wypełnionego formularza.
  await waitForIslandsHydrated(page);

  // Setup: zakładamy fiszkę przez prawdziwy formularz.
  await page.getByRole("textbox", { name: "Question" }).fill(question);
  await page.getByRole("textbox", { name: "Answer" }).fill(answer);
  await page.getByRole("button", { name: "Add card" }).click();

  // Fiszkę identyfikujemy po jej treści, nie po pozycji na liście — kolejność
  // elementów jest szczegółem implementacji, treść jest kontraktem z userem.
  const savedCard = page.getByRole("listitem").filter({ hasText: question });

  // Stan przed odświeżeniem. `CreateCardForm` dokłada fiszkę do listy dopiero
  // po `res.ok`, więc sama widoczność dowodzi, że API odpowiedziało sukcesem —
  // czekamy na konkretny stan, nie na upływ czasu.
  await expect(savedCard).toBeVisible();

  await page.reload();

  // ASERCJA RYZYKA. Po odświeżeniu lista pochodzi z SSR, czyli z bazy przez
  // RLS — nie ze stanu Reacta. Jeśli sesja nie przeżyje odświeżenia,
  // middleware odbije na /auth/signin i ta asercja padnie. Jeśli przeżyje
  // sesja, ale nie dane — element nie wróci i asercja też padnie.
  await expect(savedCard).toBeVisible();
  await expect(savedCard).toContainText(answer);
});

/**
 * Cleanup jako siatka bezpieczeństwa. Aplikacja nie ma UI do kasowania fiszek,
 * więc sprzątamy przez klienta zalogowanego na to samo konto — RLS wymaga
 * właściciela, klucza serwisowego świadomie nie używamy (test-plan.md §6.2).
 */
test.afterEach(async () => {
  const client = await authenticatedClient(readTestUser());
  await client.from("cards").delete().like("question", "E2E seed %");
});
