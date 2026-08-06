import { describe, expect, it } from "vitest";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

/**
 * Zamyka Open Question #1 z research.md: czy `astro:env/server` w Vitest
 * rozwiązuje testowy plik środowiska, czy podaje wartości z `.env`.
 *
 * Import idzie przez wirtualny moduł Astro, nie przez `process.env` — sprawdza
 * więc tę samą drogę, którą wartość pobiera `src/lib/supabase.ts`. Test
 * czytający `process.env` weryfikowałby coś innego niż to, czego dotyczy
 * ryzyko.
 */
describe("środowisko testowe", () => {
  it("kieruje testy na lokalny Supabase, nie na produkcję", () => {
    expect(SUPABASE_URL).toBeTruthy();
    expect(SUPABASE_URL).toMatch(/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/);
  });

  it("udostępnia klucz Supabase testom", () => {
    expect(SUPABASE_KEY).toBeTruthy();
  });
});
