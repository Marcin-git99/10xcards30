import { defineMiddleware } from "astro:middleware";
import { isAuthApiError, isAuthRetryableFetchError, isAuthSessionMissingError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { clearSessionCookies } from "@/lib/auth-cookies";
import { logServerError } from "@/lib/api-error";

const PROTECTED_ROUTES = ["/dashboard", "/library"];

/**
 * Rozstrzyganie sesji ma TRZY wyniki, nie dwa.
 *
 * Wcześniej ten plik destrukturyzował wyłącznie `data.user`, więc `error`
 * z `getUser()` nie był nigdzie wiązany. Cztery różne stany — brak sesji,
 * ważna sesja, token odrzucony przez serwer auth, backend auth nieosiągalny —
 * zapadały się do tego samego `user = null` i tego samego cichego
 * przekierowania. Objaw zgłaszany przez użytkownika: „wyrzuciło mnie na
 * logowanie bez komunikatu", przy CZYSTEJ konsoli, CZYSTEJ sieci i PUSTYCH
 * logach serwera. Klasa: OWASP A10:2025, warunek wyjątkowy zamieniony
 * w normalną ścieżkę sterowania.
 *
 * Granica między „nieważna sesja" a „nie wiem" nie jest naszym wynalazkiem —
 * pochodzi z SDK. `AuthRetryableFetchError` powstaje przy zerwanym transporcie
 * (status 0) oraz przy infrastrukturalnych 502/503/504/52x/530, które
 * `@supabase/auth-js` komentuje wprost jako „should not cause session
 * invalidation". Rozpoznajemy ją oficjalnym type-guardem, a nie porównaniem
 * `error.name` — bramka dostępu nie ma prawa wisieć na literale tekstowym.
 */
type SessionOutcome =
  /** Rozstrzygnięte: sesja jest albo jej nie ma. Brak sesji to stan normalny. */
  | { kind: "resolved" }
  /** Nierozstrzygnięte: backend auth nie odpowiedział. `ref` łączy log z ekranem. */
  | { kind: "unresolved"; ref: string };

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);
  let outcome: SessionOutcome = { kind: "resolved" };

  if (supabase) {
    const { data, error } = await supabase.auth.getUser();
    context.locals.user = data.user ?? null;

    // `AuthSessionMissingError` przychodzi przy KAŻDYM anonimowym żądaniu, więc
    // jest najczęstszym „błędem" w całej aplikacji i nie jest błędem wcale.
    // Logowanie go zalałoby logi szumem, a po wpięciu monitoringu przepaliło
    // miesięczny limit zdarzeń — patrz uwaga o `captureConsoleIntegration`.
    if (error && !isAuthSessionMissingError(error)) {
      const ref = logServerError(`Auth resolution failed for ${context.url.pathname}`, error);

      // Log leci niezależnie od trasy: niedostępny backend auth to awaria
      // infrastruktury, nie zdarzenie routingu. Gdyby wisiał na gałęzi
      // przekierowania, awaria dotykająca wyłącznie anonimów na stronie
      // głównej nie zostawiłaby śladu.
      if (isAuthRetryableFetchError(error)) {
        outcome = { kind: "unresolved", ref };
      } else if (isAuthApiError(error)) {
        // Serwer auth ODRZUCIŁ token, więc to ciasteczko jest bezwartościowe.
        // Zostawione jedzie z każdym kolejnym żądaniem: user krąży, dopóki sam
        // nie wyczyści przeglądarki, a każda nawigacja dopisuje wpis do logu.
        //
        // Warunek celowo wąski. `AuthRetryableFetchError` NIE MOŻE tu wejść —
        // przy nieznanym stanie kasowanie sesji zamieniłoby pięciominutowy blip
        // Supabase w wylogowanie wszystkich naraz.
        clearSessionCookies(context.request.headers, context.cookies);
      }
    }
  } else {
    context.locals.user = null;
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      // Fail closed również przy nieznanym stanie — widoczność błędu nie może
      // być kupiona za rozluźnienie bramki. Zmienia się wyłącznie to, czy user
      // dostaje czym się posłużyć w zgłoszeniu.
      //
      // Odrzucony token (`AuthApiError`) świadomie NIE dostaje `?error=`: dla
      // użytkownika jest nieodróżnialny od wygasłej sesji, więc ekran ma
      // wyglądać jak zwykłe wylogowanie. Widoczność zostaje przy operatorze.
      return context.redirect(
        outcome.kind === "unresolved" ? `/auth/signin?error=${encodeURIComponent(outcome.ref)}` : "/auth/signin",
      );
    }
  }

  return next();
});
