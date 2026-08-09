import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

/**
 * Zamienia parę (error, error_description) z OAuth na komunikat dla użytkownika.
 *
 * Kody, które realnie przychodzą z Google przez GoTrue:
 *  - "access_denied"          — użytkownik kliknął „Odmów" na ekranie zgody (NIE awaria)
 *  - "server_error"           — błąd po stronie providera
 *  - "temporarily_unavailable"— provider chwilowo niedostępny
 * `description` bywa pustym stringiem — wtedy nie ma z czego budować komunikatu.
 *
 * Decyzja produktowa (Marcin, 2026-08-09): odmowa zgody dostaje własny, zrozumiały
 * komunikat, bo to świadomy wybór użytkownika, a nie awaria. Sprawdzenie kodu idzie
 * PRZED `description` — Google bywa, że dosyła własny opis przy `access_denied`,
 * a wtedy nasz komunikat by przegrał. Pozostałe kody nadal pokazują opis providera
 * (lub sam kod, gdy opis jest pusty).
 */
function describeOAuthError(code: string, description: string): string {
  if (code === "access_denied") {
    return "You denied access";
  }

  return description || code;
}

export const GET: APIRoute = async (context) => {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    // Uwaga na `||` vs `??` wewnątrz describeOAuthError: przy odmowie zgody GoTrue
    // wysyła `error=access_denied` z PUSTYM `error_description`. Pusty string nie
    // jest nullish, więc `??` przepuszczał go dalej i użytkownik dostawał
    // `/auth/signin?error=` bez treści. Dla parametrów query pusty string znaczy
    // „brak", nie „wartość".
    const message = describeOAuthError(error, errorDescription ?? "");
    return context.redirect(`/auth/signin?error=${encodeURIComponent(message)}`);
  }

  if (!code) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("invalid_callback")}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(exchangeError.message)}`);
  }

  // Lądowanie po zalogowaniu przeniesione tu z `signin.ts` (d4aa212): po
  // przejściu na OAuth to callback jest miejscem, w którym sesja już istnieje.
  // Świadomie bez parametru powrotu (`?redirect=`): produkt ma dziś jeden ekran
  // po zalogowaniu, więc taki parametr nie miałby czego obsłużyć, a wprowadzałby
  // powierzchnię na otwarte przekierowanie.
  return context.redirect("/dashboard");
};
