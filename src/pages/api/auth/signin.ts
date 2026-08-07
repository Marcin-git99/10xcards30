import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`);
  }

  // Po zalogowaniu użytkownik trafia wprost do swoich fiszek, a nie na stronę
  // powitalną, z której dashboard był tylko małym linkiem w rogu. Świadomie bez
  // parametru powrotu (`?redirect=`): produkt ma dziś jeden ekran po
  // zalogowaniu, więc taki parametr nie miałby czego obsłużyć, a wprowadzałby
  // powierzchnię na otwarte przekierowanie.
  return context.redirect("/dashboard");
};
