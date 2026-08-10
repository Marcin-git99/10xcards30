import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { APIContext, MiddlewareNext } from "astro";
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";

/**
 * Ryzyko #1, twarz druga: **połknięty błąd rozstrzygania sesji**.
 *
 * Zgłoszenie, od którego zaczęło się to dochodzenie: „byłem zalogowany, kliknąłem
 * w zakładkę i wyrzuciło mnie na logowanie — bez żadnego komunikatu". Trzy kanały
 * diagnostyczne milczały: konsola przeglądarki bez błędów, sieć bez nieudanych
 * żądań, logi serwera PUSTE. Objaw odtworzony lokalnie na zepsutym podpisie JWT.
 *
 * Przyczyna: `src/middleware.ts` destrukturyzował wyłącznie `data.user`, a pole
 * `error` z `supabase.auth.getUser()` nie było nigdzie wiązane. Cztery różne
 * stany zapadały się do tego samego `user = null` i tego samego cichego
 * przekierowania. To wzorzec A10:2025 (Mishandling of Exceptional Conditions):
 * warunek wyjątkowy zamieniony w normalną ścieżkę sterowania.
 *
 * Scenariusze zdjęte z ŻYWEGO `@supabase/ssr` sondą dochodzeniową, nie
 * wymyślone — bo cały sens tego testu zależy od tego, że rozróżnienie między
 * nimi jest prawdziwe:
 *
 *   | scenariusz                | klasa                     | status |
 *   | anonim (brak ciasteczka)  | AuthSessionMissingError   | 400    |
 *   | podpis JWT odrzucony      | AuthApiError              | 403    |
 *   | Supabase nieosiągalny     | AuthRetryableFetchError   | 0      |
 *
 * Błędy są PRAWDZIWYMI instancjami klas SDK, nie literałami o tym samym
 * kształcie. To nie jest pedanteria: `isAuthSessionMissingError` i spółka
 * sprawdzają najpierw markera `__isAuthError`, którego zwykły obiekt nie ma.
 * Podrobiony błąd przeleciałby przez każdy guard jako `false` i test zrobiłby
 * się zielony z zupełnie innego powodu niż badany.
 *
 * Dlaczego hermetycznie, a nie integracyjnie: dwa z trzech stanów to awarie
 * infrastruktury, a jeden z nich (nieosiągalny Supabase) wymagałby ubicia bazy,
 * której ta sama suita używa do testów izolacji. Stub podmienia GRANICĘ
 * (klienta Supabase); middleware wykonuje swoją realną ścieżkę.
 */

const AUTH_ERRORS = {
  /** Anonim. To NIE jest awaria — tak wygląda każde wejście bez sesji. */
  sessionMissing: () => new AuthSessionMissingError(),
  /** Serwer auth aktywnie odrzucił token. Sesja nieważna, ale odpowiedź JEST. */
  invalidJwt: () =>
    new AuthApiError("invalid JWT: unable to parse or verify signature, token signature is invalid", 403, "bad_jwt"),
  /** Brak odpowiedzi. Stan uwierzytelnienia NIEZNANY — to jest ta groźna. */
  unreachable: () => new AuthRetryableFetchError("fetch failed", 0),
};

const getUser = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getUser } }),
}));

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

const TOKEN = "sb-127-auth-token";
const VERIFIER = `${TOKEN}-code-verifier`;

function requestFor(pathname: string, cookieNames: string[] = [TOKEN]) {
  const url = new URL(`http://localhost${pathname}`);
  const redirect = vi.fn((location: string) => new Response(null, { status: 302, headers: { location } }));
  const deletedNames: string[] = [];

  const context = {
    url,
    request: new Request(url, { headers: { Cookie: cookieNames.map((name) => `${name}=wartosc`).join("; ") } }),
    cookies: {
      delete: vi.fn((name: string) => deletedNames.push(name)),
      set: vi.fn(),
      get: vi.fn(),
    },
    locals: {},
    redirect,
  } as unknown as APIContext;

  const next = vi.fn(() => new Response("strona")) as unknown as MiddlewareNext;

  return {
    context,
    next,
    redirect,
    deleted: () => deletedNames,
    locals: context.locals as { user?: unknown },
  };
}

/** Wyciąga `?error=` z adresu, na który middleware przekierował. */
function errorParam(redirect: MockInstance<(location: string) => Response>): string | null {
  const location = redirect.mock.calls[0]?.[0];
  if (typeof location !== "string") return null;
  return new URL(location, "http://localhost").searchParams.get("error");
}

/**
 * Rozbiór wywołania `console.error` na dwie części, które `logServerError`
 * przekazuje osobno: nagłówek `[ref] kontekst` i surowy szczegół.
 *
 * Świadomie NIE asertujemy na `JSON.stringify(mock.calls)`. Serializacja błędu
 * przechodzi przez `AuthError.toJSON()`, więc asercja na tekst przeszłaby
 * również wtedy, gdyby middleware zalogował gołego stringa zamiast obiektu
 * błędu — a wtedy operator traci status, kod i stack.
 */
const logHeaders = (spy: MockInstance<typeof console.error>): string[] => spy.mock.calls.map((call) => String(call[0]));
const logDetails = (spy: MockInstance<typeof console.error>): unknown[] =>
  spy.mock.calls.map((call): unknown => call[1]);

describe("middleware wobec awarii rozstrzygania sesji", () => {
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    getUser.mockReset();
  });

  describe("Supabase nieosiągalny — stan uwierzytelnienia nieznany", () => {
    beforeEach(() => {
      getUser.mockResolvedValue({ data: { user: null }, error: AUTH_ERRORS.unreachable() });
    });

    it("zostawia ślad w logu serwera zamiast odbijać po cichu", async () => {
      const { onRequest } = await import("@/middleware");
      const { context, next } = requestFor("/dashboard");

      await onRequest(context, next);

      // Sedno całego dochodzenia: dziś ta asercja pada, bo `error` nie jest
      // nigdzie wiązany. Operator nie ma CZEGO szukać w logach, gdy przyjdzie
      // zgłoszenie „wyrzuciło mnie na logowanie".
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(logDetails(consoleError)[0]).toBeInstanceOf(AuthRetryableFetchError);
    });

    it("łączy ekran użytkownika z wpisem w logu tym samym refem", async () => {
      const { onRequest } = await import("@/middleware");
      const { context, next, redirect } = requestFor("/dashboard");

      await onRequest(context, next);

      // Ta sama zasada, którą `src/lib/api-error.ts` wprowadził dla API:
      // redakcja bez korelacji zamienia jeden problem na drugi. Dwa niezależnie
      // wygenerowane identyfikatory przeszłyby asercję „ref istnieje" i po cichu
      // zerwały jedyny powód, dla którego ref w ogóle jest w adresie.
      const ref = errorParam(redirect);
      expect(ref).toMatch(UUID);
      expect(logHeaders(consoleError)[0]).toContain(ref);
    });

    it("nadal nie wpuszcza na trasę chronioną (fail closed)", async () => {
      const { onRequest } = await import("@/middleware");
      const { context, next, redirect } = requestFor("/dashboard");

      await onRequest(context, next);

      // Widoczność błędu NIE MOŻE być kupiona za rozluźnienie bramki. Bez tej
      // asercji „naprawa" polegająca na przepuszczaniu przy nieznanym stanie
      // przeszłaby oba testy powyżej — i zamieniła buga UX w dziurę dostępu.
      expect(redirect).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it("NIE kasuje ciasteczka sesji przy nieznanym stanie", async () => {
      const { onRequest } = await import("@/middleware");
      const { context, next, deleted } = requestFor("/dashboard");

      await onRequest(context, next);

      // NAJWAŻNIEJSZA asercja negatywna w tym pliku. Chwilowy blip infrastruktury
      // nie może kasować sesji — inaczej pięciominutowa awaria Supabase
      // wylogowałaby wszystkich użytkowników naraz, a naprawa obserwowalności
      // stałaby się awarią produktu. Kasujemy TYLKO tam, gdzie serwer auth
      // rzeczywiście odrzucił token.
      expect(deleted()).toEqual([]);
    });

    it("melduje awarię także wtedy, gdy trasa jest publiczna", async () => {
      const { onRequest } = await import("@/middleware");
      const { context, next } = requestFor("/");

      await onRequest(context, next);

      // Niedostępny backend auth to awaria infrastruktury, nie zdarzenie
      // routingu. Gdyby log wisiał na gałęzi przekierowania, awaria widoczna
      // wyłącznie dla anonimów na stronie głównej nie zostawiłaby śladu.
      expect(consoleError).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe("podpis JWT odrzucony — sesja nieważna, ale odpowiedź jest", () => {
    beforeEach(() => {
      getUser.mockResolvedValue({ data: { user: null }, error: AUTH_ERRORS.invalidJwt() });
    });

    it("loguje odrzucenie tokenu", async () => {
      const { onRequest } = await import("@/middleware");
      const { context, next } = requestFor("/dashboard");

      await onRequest(context, next);

      // Pojedyncze zdarzenie jest nudne (wygasła sesja). Wysyp tych samych
      // wpisów naraz znaczy rotację sekretu JWT albo atak — i tylko log
      // pozwala to zobaczyć.
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(logDetails(consoleError)[0]).toBeInstanceOf(AuthApiError);
    });

    it("nie straszy użytkownika komunikatem o błędzie", async () => {
      const { onRequest } = await import("@/middleware");
      const { context, next, redirect } = requestFor("/dashboard");

      await onRequest(context, next);

      // Decyzja produktowa (Marcin, 2026-08-09): dla użytkownika to jest
      // nieodróżnialne od wygasłej sesji, więc ekran ma wyglądać jak zwykłe
      // wylogowanie. Widoczność zostaje po stronie operatora.
      expect(redirect).toHaveBeenCalledWith("/auth/signin");
      expect(errorParam(redirect)).toBeNull();
    });

    it("kasuje odrzucone ciasteczko, żeby przerwać pętlę", async () => {
      const { onRequest } = await import("@/middleware");
      const { context, next, deleted } = requestFor("/dashboard");

      await onRequest(context, next);

      // Bez tego user krąży: ciasteczko jedzie z każdym kolejnym żądaniem, więc
      // nie wyjdzie z pętli bez ręcznego czyszczenia przeglądarki, a KAŻDA
      // nawigacja dopisuje wpis do logu. Zmierzone na żywym serwerze: jedna
      // zepsuta sesja dała wpisy dla `/dashboard`, `/auth/signin` ORAZ `/` —
      // objętość logów rośnie z odsłonami, nie z liczbą userów.
      expect(deleted()).toContain(TOKEN);
    });

    it("NIE kasuje code verifiera PKCE", async () => {
      const { onRequest } = await import("@/middleware");
      const { context, next, deleted } = requestFor("/api/auth/callback", [TOKEN, VERIFIER]);

      await onRequest(context, next);

      // Trasa wybrana nieprzypadkowo: middleware biegnie po KAŻDYM żądaniu,
      // także po callbacku OAuth. Skasowanie verifiera wywróciłoby
      // `exchangeCodeForSession()` w `callback.ts` i zamieniło naprawę pętli
      // w awarię logowania — czyli bug gorszy od naprawianego.
      expect(deleted()).not.toContain(VERIFIER);
    });
  });

  describe("anonim — brak sesji to stan normalny, nie awaria", () => {
    beforeEach(() => {
      getUser.mockResolvedValue({ data: { user: null }, error: AUTH_ERRORS.sessionMissing() });
    });

    it("nie loguje niczego przy zwykłym wejściu bez sesji", async () => {
      const { onRequest } = await import("@/middleware");
      const { context, next } = requestFor("/");

      await onRequest(context, next);

      // Bramka kosztowa, nie kosmetyka. `AuthSessionMissingError` przychodzi
      // przy KAŻDYM anonimowym żądaniu, czyli najczęstszym w całej aplikacji.
      // Naiwne „loguj każdy niepusty error" zalałoby logi i przepaliło limit
      // zdarzeń monitoringu w jeden dzień — dlatego test pilnuje CISZY.
      expect(consoleError).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("odbija anonima z trasy chronionej bez komunikatu i bez logu", async () => {
      const { onRequest } = await import("@/middleware");
      const { context, next, redirect } = requestFor("/library");

      await onRequest(context, next);

      expect(redirect).toHaveBeenCalledWith("/auth/signin");
      expect(consoleError).not.toHaveBeenCalled();
    });
  });

  describe("ważna sesja — regresja bramki w drugą stronę", () => {
    beforeEach(() => {
      getUser.mockResolvedValue({ data: { user: { id: "u-1", email: "a@example.com" } }, error: null });
    });

    it("przepuszcza zalogowanego na trasę chronioną i nie hałasuje", async () => {
      const { onRequest } = await import("@/middleware");
      const { context, next, redirect, locals } = requestFor("/dashboard");

      await onRequest(context, next);

      // Druga połowa Ryzyka #1 („zalogowany user jest odbijany od własnych
      // ekranów"). Cała ta zmiana dotyka gałęzi, przez którą przechodzi każde
      // żądanie — happy path musi być obwarowany razem z nią.
      expect(next).toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
      expect(locals.user).toMatchObject({ id: "u-1" });
      expect(consoleError).not.toHaveBeenCalled();
    });

    it("nie tyka ciasteczek zdrowej sesji", async () => {
      const { onRequest } = await import("@/middleware");
      const { context, next, deleted } = requestFor("/dashboard");

      await onRequest(context, next);

      // Gdyby kasowanie wyciekło poza gałąź błędu, każde żądanie wyrzucałoby
      // usera z aplikacji. Ta asercja kosztuje trzy linie i zamyka tę klasę.
      expect(deleted()).toEqual([]);
    });
  });
});
