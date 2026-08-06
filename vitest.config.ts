/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";

// getViteConfig() daje testom te same aliasy (@/*) i wirtualne moduły Astro,
// których używa kod aplikacji — w tym `astro:env/server`. Bez tego guard
// środowiskowy z test/setup.ts nie mógłby sprawdzić wartości, którą naprawdę
// widzi `src/lib/supabase.ts`.
//
// Drugi argument zdejmuje adapter Cloudflare na czas testów: jego plugin Vite
// odrzuca `resolve.external`, które Vitest ustawia dla środowiska SSR
// ("The following environment options are incompatible with the Cloudflare
// Vite plugin"). Testy tej fazy nie dotykają runtime'u workerd — sprawdzają
// reguły bazy i kształt odpowiedzi endpointu — więc adapter nie jest im do
// niczego potrzebny. Zachowanie specyficzne dla edge zostaje przy ręcznym
// smoke teście na wdrożonym środowisku (test-plan.md §5).
export default getViteConfig(
  {
    test: {
      // Astro 6 nie pozwala renderować komponentów .astro w klienckich
      // środowiskach Vitest — patrz guides/upgrade-to/v6.
      environment: "node",
      setupFiles: ["./test/setup.ts"],
      include: ["test/**/*.test.ts"],
    },
  },
  {
    adapter: undefined,
    output: "static",
  },
);
