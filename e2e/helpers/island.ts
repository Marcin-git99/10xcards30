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
 *
 * Budżet. Zmierzone na zbudowanej aplikacji, w świeżym kontekście
 * przeglądarki (zimny cache klienta, czyli tak jak startuje każdy test):
 * **330–687 ms**, pięć prób. Domyślne 30 s to ponad czterdziestokrotność
 * wartości typowej — zapas na zimne wyjątki (pierwsze wydanie assetów przez
 * workerd, kontencja między workerami), a nie na maskowanie regresji: gdyby
 * hydratacja zwolniła do sekund, nadal mieścimy się w limicie i test tego nie
 * ukryje, bo nie o czas tu asercjonujemy.
 *
 * Zimną ścieżkę i tak płaci raz projekt `setup` (`e2e/auth.setup.ts`), zanim
 * ruszy którykolwiek test.
 */
export async function waitForIslandsHydrated(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll("astro-island[ssr]").length === 0, null, { timeout });
}
