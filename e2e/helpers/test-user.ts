import fs from "node:fs";
import path from "node:path";
import type { Cookie } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { loadTestEnv } from "./env";

export const AUTH_DIR = path.resolve(process.cwd(), "playwright/.auth");
export const STORAGE_STATE = path.join(AUTH_DIR, "user.json");
const CREDENTIALS_FILE = path.join(AUTH_DIR, "user-meta.json");

export interface TestUser {
  email: string;
  password: string;
  userId: string;
}

/**
 * Dlaczego sesja powstaje programowo, a nie przez formularz logowania.
 *
 * Po F-02 `POST /api/auth/signin` ignoruje e-mail i hasło — wywołuje
 * `signInWithOAuth({ provider: "google" })` i przekierowuje do Google
 * (patrz `src/pages/api/auth/signin.ts`). Jedyna droga przez UI prowadzi więc
 * przez cudzego dostawcę tożsamości: wolna, niedeterministyczna i zależna od
 * konta, którego nie kontrolujemy.
 *
 * Reguły E2E mówią wprost: uwierzytelniaj się **z pominięciem UI**. Sesję
 * składamy tym samym klientem `@supabase/ssr`, którego używa aplikacja
 * (`src/lib/supabase.ts`), więc format i nazwy ciasteczek pozostają zgodne z
 * produkcyjnymi — łącznie z dzieleniem tokenu na fragmenty. Prawdziwe
 * pozostają wszystkie granice, o które chodzi w ryzykach: middleware,
 * routing, API i baza z RLS.
 *
 * To NIE zwalnia z testowania samej bramki logowania — ta ścieżka ma własny,
 * osobny scenariusz i nie jest zależnością dla pozostałych testów.
 */
export async function createTestUser(label: string): Promise<TestUser> {
  const { supabaseUrl, supabaseKey } = loadTestEnv();
  const email = `e2e_${label}_${Date.now()}@example.com`;
  const password = `pw_${Math.random().toString(36).slice(2)}A1!`;

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw new Error(`Nie udało się założyć konta E2E ${email}: ${error.message}`);
  if (!data.user) throw new Error(`signUp nie zwrócił usera dla ${email}`);
  if (!data.session) {
    throw new Error(
      `signUp nie zwrócił sesji dla ${email} — sprawdź [auth.email] enable_confirmations w supabase/config.toml`,
    );
  }

  return { email, password, userId: data.user.id };
}

/**
 * Loguje usera klientem `@supabase/ssr` i przechwytuje ciasteczka, które ten
 * klient by ustawił — czyli dokładnie te, których oczekuje middleware.
 */
export async function sessionCookies(user: TestUser, appOrigin: string): Promise<Cookie[]> {
  const { supabaseUrl, supabaseKey } = loadTestEnv();
  const captured: { name: string; value: string }[] = [];

  const client = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => [],
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) captured.push({ name, value });
      },
    },
  });

  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw new Error(`Nie udało się zalogować konta E2E ${user.email}: ${error.message}`);
  if (captured.length === 0) {
    throw new Error("Klient @supabase/ssr nie ustawił żadnych ciasteczek — zmienił się kontrakt storage adaptera?");
  }

  const { hostname } = new URL(appOrigin);
  return captured.map(({ name, value }) => ({
    name,
    value,
    domain: hostname,
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: "Lax" as const,
  }));
}

/** Klient zalogowany jako user testowy — do sprzątania danych przy RLS. */
export async function authenticatedClient(user: TestUser) {
  const { supabaseUrl, supabaseKey } = loadTestEnv();
  const client = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw new Error(`Nie udało się zalogować klienta sprzątającego: ${error.message}`);
  return client;
}

export function saveTestUser(user: TestUser): void {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(user, null, 2), "utf8");
}

/** Odczytuje usera zapisanego przez projekt `setup`. */
export function readTestUser(): TestUser {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    throw new Error(`Brak ${CREDENTIALS_FILE} — czy projekt "setup" (auth.setup.ts) na pewno się wykonał?`);
  }
  return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf8")) as TestUser;
}
