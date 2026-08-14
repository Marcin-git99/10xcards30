import { test, expect } from "@playwright/test";
import { waitForIslandsHydrated } from "./helpers/island";

/**
 * Pokrywa S-01 (`context/changes/first-gated-generation/plan.md`, Faza 5):
 * pełna ścieżka klienta wklej → generuj → przejrzyj/edytuj/usuń → zatwierdź →
 * `/library` z banerem — bez dotykania prawdziwego OpenRoutera i bez zapisu
 * do bazy w kroku generacji. Prawdziwy round-trip przez OpenRouter zostaje
 * manualny (Manual Verification w planie) — koszt i niedeterminizm modelu
 * czynią go złym kandydatem na automatyzację; ten test dowodzi za to, czego
 * OpenRouter nie dotyczy: maszyny stanu `GenerationSection`, edycji/usuwania
 * kandydatów przed zapisem i przekierowania z banerem po zatwierdzeniu.
 *
 * Wzorzec lokatorów: `getByRole`, tak jak `seed.spec.ts`/`auth-gate.spec.ts`.
 * Pola pytania/odpowiedzi w `GenerationSection` nie mają jawnej etykiety —
 * ich dostępna nazwa pochodzi z atrybutu `placeholder` ("Pytanie"/"Odpowiedź"),
 * co przeglądarka (i Playwright) liczy jako nazwę dostępną wg HTML-AAM, gdy
 * nie ma innej etykiety. Te nazwy są unikalne na stronie (formularz ręczny
 * używa angielskich "Question"/"Answer"), więc nie kolidują z resztą Dashboardu.
 *
 * Zamiast lokalizować konkretną kartę po treści (wartość `<input>` nie jest
 * tekstem węzła, więc `filter({ hasText })` jej nie widzi), test operuje na
 * pozycji (`.nth()`) — wystarczające dowodowo: liczy się, że edycja i usunięcie
 * odzwierciedlają się w stanie wysyłanym do `/approve`, nie który dokładnie
 * indeks został tknięty.
 *
 * Brak `test.afterEach`: obie odpowiedzi API są przechwycone przez
 * `page.route()` i nigdy nie docierają do serwera, więc generacja nie
 * zapisuje wiersza w `generations` ani w `cards` — nie ma czego sprzątać.
 * Pierwszy e2e spec w tym repo bez cleanupu, celowo.
 */

const FAKE_GENERATION_ID = "11111111-1111-1111-1111-111111111111";

const sourceText = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(10).slice(0, 520);

const cannedCandidates = Array.from({ length: 5 }, (_, i) => ({
  question: `Kandydat pytanie ${i + 1}`,
  answer: `Kandydat odpowiedź ${i + 1}`,
}));

test("paste → generate → edit/remove → approve redirects to /library with banner", async ({ page }) => {
  await page.goto("/dashboard");
  await waitForIslandsHydrated(page);

  // Przechwycenie PRZED wypełnieniem pola, żeby żadne żądanie generacji nie
  // miało szansy uciec do prawdziwego OpenRoutera.
  await page.route("**/api/generations", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ generation_id: FAKE_GENERATION_ID, cards: cannedCandidates }),
    });
  });

  await page.getByPlaceholder("Wklej tekst źródłowy (500–5000 znaków)…").fill(sourceText);
  await page.getByRole("button", { name: "Generuj fiszki z AI" }).click();

  const questionInputs = page.getByRole("textbox", { name: "Pytanie" });
  const answerInputs = page.getByRole("textbox", { name: "Odpowiedź" });
  await expect(questionInputs).toHaveCount(5);

  // Edycja: zmieniamy odpowiedź drugiego kandydata.
  const editedAnswer = "Ręcznie poprawiona odpowiedź";
  await answerInputs.nth(1).fill(editedAnswer);
  await expect(answerInputs.nth(1)).toHaveValue(editedAnswer);

  // Usunięcie: pierwszy kandydat znika, zostaje 4.
  await page.getByRole("button", { name: "Usuń tę propozycję" }).first().click();
  await expect(questionInputs).toHaveCount(4);
  await expect(page.getByText("Kandydat pytanie 1", { exact: true })).toHaveCount(0);

  // Przechwycenie approve — asercja na wysłane body dowodzi, że edycja i
  // usunięcie naprawdę dotarły do stanu wysyłanego na serwer, nie tylko do UI.
  let approveRequestBody: { cards: { question: string; answer: string }[] } | undefined;
  await page.route(`**/api/generations/${FAKE_GENERATION_ID}/approve`, async (route) => {
    approveRequestBody = route.request().postDataJSON() as typeof approveRequestBody;
    const insertedCards = (approveRequestBody?.cards ?? []).map((c, i) => ({
      id: `22222222-2222-2222-2222-22222222222${i}`,
      ...c,
      source: "ai",
      generation_id: FAKE_GENERATION_ID,
    }));
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ cards: insertedCards }),
    });
  });

  await page.getByRole("button", { name: "Zatwierdź i przejdź do nauki" }).click();

  await page.waitForURL(/\/library/);

  expect(approveRequestBody?.cards).toHaveLength(4);
  expect(approveRequestBody?.cards.some((c) => c.answer === editedAnswer)).toBe(true);
  expect(approveRequestBody?.cards.some((c) => c.question === "Kandydat pytanie 1")).toBe(false);

  await expect(page.getByRole("status").filter({ hasText: "4" })).toBeVisible();
});
