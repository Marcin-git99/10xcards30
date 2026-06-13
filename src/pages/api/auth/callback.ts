import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    const message = errorDescription ?? error;
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
