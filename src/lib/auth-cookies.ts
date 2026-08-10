import type { AstroCookies } from "astro";
import { parseCookieHeader } from "@supabase/ssr";

/**
 * Kasowanie ciasteczek sesji Supabase — jedno miejsce dla dwóch ścieżek, które
 * potrzebują tego z przeciwnych powodów.
 *
 * `src/pages/api/auth/signout.ts` — gdy `signOut()` padnie na awarii
 * infrastruktury, `@supabase/auth-js` wychodzi PRZED `_removeSession()`, więc
 * ciasteczka zostają ważne mimo „udanego" wylogowania (fail safe: wyloguj i tak).
 *
 * `src/middleware.ts` — gdy serwer auth odrzuci token (`AuthApiError`), bez
 * wyczyszczenia ciasteczka user krąży między ekranami, a każda nawigacja dopisuje
 * wpis do logu; objętość logów rośnie z odsłonami, nie z liczbą userów.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DLACZEGO NIE „wszystko z prefiksem `sb-`"
 *
 * Pod tym prefiksem `@supabase/ssr` trzyma dwie różne rzeczy: token sesji ORAZ
 * code verifier PKCE (`<klucz>-code-verifier`). Middleware biegnie po KAŻDYM
 * żądaniu, w tym po `/api/auth/callback` — a tam skasowanie verifiera wywróciłoby
 * `exchangeCodeForSession()` i zamieniło naprawę wylogowania w awarię logowania.
 * Kasujemy token sesji i jego fragmenty. Nic więcej.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Nazwy fragmentów odwzorowują kontrakt chunkera z `@supabase/ssr`
 * (`CHUNK_LIKE_REGEX = /^(.*)[.](0|[1-9][0-9]*)$/`): token dłuższy niż
 * MAX_CHUNK_SIZE (3180) leży w `<klucz>.0`, `<klucz>.1`, … Skasowanie tylko
 * części zostawia sesję w stanie, którego nikt nie testował.
 *
 * Opcje kasowania muszą pokrywać się z `DEFAULT_COOKIE_OPTIONS` (`path: "/"`),
 * inaczej przeglądarka potraktuje to jako inne ciasteczko i `delete` po cichu
 * nic nie zrobi.
 */
const SESSION_COOKIE = /^sb-.+-auth-token(\.(?:0|[1-9][0-9]*))?$/;

/**
 * Kasuje ciasteczka sesji Supabase obecne w żądaniu.
 *
 * @returns nazwy skasowanych ciasteczek — do zalogowania, żeby dało się odróżnić
 *          „nie było czego kasować" od „skasowano".
 */
export function clearSessionCookies(requestHeaders: Headers, cookies: AstroCookies): string[] {
  const names = parseCookieHeader(requestHeaders.get("Cookie") ?? "")
    .map(({ name }) => name)
    .filter((name) => SESSION_COOKIE.test(name));

  for (const name of names) {
    cookies.delete(name, { path: "/" });
  }

  return names;
}
