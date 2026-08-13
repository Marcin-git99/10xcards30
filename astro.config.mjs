// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";
import process from "node:process";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
  // Vitest ustawia `resolve.external` dla środowiska SSR, co plugin Vite
  // adaptera Cloudflare odrzuca jako niekompatybilne. Testy tej bazy nie
  // dotykają runtime'u workerd (sprawdzają reguły bazy i kształt odpowiedzi
  // endpointów), więc pod runnerem adapter jest zbędny. Poza Vitest — zawsze
  // Cloudflare.
  adapter: process.env.VITEST ? undefined : cloudflare(),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
