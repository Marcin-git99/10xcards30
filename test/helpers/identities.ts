import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

// Typ wywnioskowany z fabryki — jawna adnotacja `SupabaseClient` rozjeżdża się
// z domyślnymi parametrami generycznymi, które ustawia `createClient`.
type TestClient = ReturnType<typeof anonClient>;

/**
 * Fixture dwóch niezależnych tożsamości przeciw lokalnemu Supabase.
 *
 * Zwykłe `signUp()` wystarcza, bo `supabase/config.toml` ma
 * `[auth.email] enable_confirmations = false` — konto dostaje sesję od razu,
 * bez maila i bez klucza serwisowego. Świadomie NIE używamy klucza
 * serwisowego: omija on RLS, a to jest dokładnie ta warstwa, której te testy
 * mają bronić.
 *
 * Każdy klient dostaje `persistSession: false`, żeby sesje nie wyciekały
 * między plikami testów przez współdzielony magazyn.
 */
export interface Identity {
  client: TestClient;
  userId: string;
  email: string;
}

function anonClient() {
  // Guard z test/setup.ts zdążył już przerwać przebieg, gdyby to nie był
  // lokalny stack — ale zmienne są opcjonalne w schemacie astro:env, więc
  // TypeScript nadal widzi `string | undefined`.
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("brak SUPABASE_URL/SUPABASE_KEY — guard z test/setup.ts powinien był już przerwać przebieg");
  }
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Klient bez sesji — rola `anon`. Nie ma dla niej żadnej polityki RLS. */
export function createAnonymousClient(): TestClient {
  return anonClient();
}

let counter = 0;

/** Zakłada nowe konto i zwraca uwierzytelnionego klienta. */
export async function createIdentity(label: string): Promise<Identity> {
  counter += 1;
  const email = `iso_${label}_${Date.now()}_${counter}@example.com`;
  const client = anonClient();

  const { data, error } = await client.auth.signUp({ email, password: "password123" });
  if (error) throw new Error(`nie udało się założyć konta ${email}: ${error.message}`);
  if (!data.user) throw new Error(`signUp nie zwrócił usera dla ${email}`);
  if (!data.session) {
    throw new Error(
      `signUp nie zwrócił sesji dla ${email} — sprawdź [auth.email] enable_confirmations w supabase/config.toml`,
    );
  }

  return { client, userId: data.user.id, email };
}
