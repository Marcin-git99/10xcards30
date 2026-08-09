import type { Page } from "@playwright/test";

/**
 * Czeka, aż wyspy Astro zakończą hydratację.
 *
 * Dlaczego to jest potrzebne w KAŻDYM teście dotykającym formularza:
 * Astro renderuje wyspy React na serwerze, a hydratuje je dopiero po
 * załadowaniu strony (`client:load`). W oknie między jednym a drugim strona
 * wygląda na gotową — pola są w DOM i przyjmują tekst — ale React nie ma
 * jeszcze podpiętych handlerów, więc `useState` zostaje pusty.
 *
 * Skutek jest mylący: `fill()` zostawia wartość widoczną w DOM, natomiast
 * `validate()` w komponencie widzi pusty stan i blokuje wysyłkę. Test pada z
 * komunikatem „pole nie może być puste" przy screenshocie pokazującym
 * wypełniony formularz.
 *
 * Uwaga o regule lokatorów: reguły E2E zabraniają selektorów CSS **do
 * wskazywania elementów interfejsu** — bo łamią się przy refaktorze i nie
 * odpowiadają temu, co widzi user. Tutaj nie lokalizujemy elementu, tylko
 * odpytujemy o etap cyklu życia frameworka; `astro-island[ssr]` to kontrakt
 * runtime'u Astro (atrybut `ssr` znika po hydratacji), nie struktura DOM
 * naszych komponentów. To czekanie na STAN, nie na czas — żadnego
 * `waitForTimeout`.
 */
export async function waitForIslandsHydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll("astro-island[ssr]").length === 0, null, {
    timeout: 15_000,
  });
}
