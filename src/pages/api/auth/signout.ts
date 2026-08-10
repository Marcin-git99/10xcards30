import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { clearSessionCookies } from "@/lib/auth-cookies";
import { logServerError } from "@/lib/api-error";

/**
 * Wylogowanie działa w trybie **fail safe**: jeśli unieważnienie sesji po stronie
 * serwera nie przejdzie, i tak kasujemy ciasteczka lokalnie.
 *
 * Wcześniej wynik `signOut()` był wyrzucany w całości, a redirect leciał
 * bezwarunkowo. Wyglądało to niewinnie, bo zwykle SDK samo sprząta ciasteczka —
 * ale robi to w `_removeSession()`, do którego przy błędzie NIETOLEROWANYM
 * (awaria infrastruktury; 401/403/404 są tolerowane i przechodzą dalej) w ogóle
 * nie dochodzi. User dostawał stronę główną i żywą sesję. Na współdzielonym
 * komputerze następna osoba była zalogowana jako on.
 *
 * Porównaj z `src/middleware.ts`: tam ten sam stan „nie wiem" znaczy „nie
 * wpuszczaj" (fail closed), tu znaczy „wyloguj mimo wszystko" (fail safe). Ta
 * sama zasada — w niepewności idź w stronę mniejszego dostępu.
 *
 * Czego to NIE naprawia: refresh token pozostaje ważny po stronie serwera aż do
 * wygaśnięcia. Chronimy scenariusz współdzielonej przeglądarki, nie skradzionego
 * tokenu — dlatego nieudane unieważnienie musi zostawić ślad w logu.
 */
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const { error } = await supabase.auth.signOut();

    if (error) {
      // Kasujemy PRZED logowaniem, żeby liczba w komunikacie opisywała stan
      // faktyczny, a nie zamiar.
      const cleared = clearSessionCookies(context.request.headers, context.cookies);
      logServerError(`signout: revocation failed, cleared ${cleared.length} session cookie(s)`, error);
    }
  }

  // Bez zmiany UX: user kliknął „wyloguj" i ma wyjść. Straszenie go błędem przy
  // czynności, która z jego punktu widzenia się udała, nic nie wnosi.
  return context.redirect("/");
};
