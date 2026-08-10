import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from "vitest";
import type { APIContext } from "astro";
import { AuthRetryableFetchError } from "@supabase/supabase-js";

/**
 * Ryzyko #3, twarz trzecia: **wylogowanie, które nie wylogowuje**.
 *
 * `POST /api/auth/signout` wyrzucał `{ error }` z `signOut()` w całości i
 * przekierowywał na `/` bezwarunkowo. Wygląda niewinnie, dopóki nie prześledzi
 * się `_signOut()` w `@supabase/auth-js`:
 *
 *   if (error) {
 *     if (!(tolerowane: 404 | 401 | 403 | session missing)) {
 *       return this._returnResult({ error });   // ← WYJŚCIE
 *     }
 *   }
 *   if (scope !== 'others') {
 *     await this._removeSession();              // ← tu dopiero znikają ciasteczka
 *   }
 *
 * Przy błędzie NIETOLEROWANYM — czyli awarii infrastruktury — SDK wychodzi przed
 * `_removeSession()`. Nie leci event `SIGNED_OUT`, więc `applyServerStorage`
 * z `@supabase/ssr` nie ma czego skasować i ciasteczko sesji **zostaje ważne**.
 * User widzi stronę główną i uważa, że wyszedł. Na współdzielonym komputerze
 * następna osoba jest zalogowana jako on. W logach: nic.
 *
 * Kierunek naprawy jest ODWROTNY niż w `middleware-auth-failure.test.ts` i to
 * jest sedno: tam stan „nie wiem" znaczy „nie wpuszczaj" (fail closed), tu
 * znaczy „wyloguj mimo wszystko" (fail safe). Jedna zasada — w niepewności idź
 * w stronę mniejszego dostępu — dwie różne mechaniki.
 *
 * Uczciwa granica tej naprawy: czyszczenie ciasteczka NIE unieważnia refresh
 * tokenu po stronie serwera. Kto go wcześniej przechwycił, nadal go ma. Chronimy
 * scenariusz współdzielonej przeglądarki, nie skradzionego tokenu.
 */

const signOut = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { signOut } }),
}));

const TOKEN = "sb-127-auth-token";
const VERIFIER = `${TOKEN}-code-verifier`;

interface SignoutHarness {
  context: APIContext;
  deleted: () => string[];
  redirect: Mock<(location: string) => Response>;
}

function signoutRequest(cookieNames: string[]): SignoutHarness {
  const cookieHeader = cookieNames.map((name) => `${name}=wartosc`).join("; ");
  const deletedNames: string[] = [];

  const redirect = vi.fn((location: string) => new Response(null, { status: 302, headers: { location } }));

  const context = {
    request: new Request("http://localhost/api/auth/signout", {
      method: "POST",
      headers: { Cookie: cookieHeader },
    }),
    cookies: {
      delete: vi.fn((name: string) => deletedNames.push(name)),
      set: vi.fn(),
      get: vi.fn(),
    },
    redirect,
  } as unknown as APIContext;

  return { context, deleted: () => deletedNames, redirect };
}

describe("POST /api/auth/signout wobec awarii unieważniania sesji", () => {
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    signOut.mockReset();
  });

  describe("gdy backend auth nie odpowiada", () => {
    beforeEach(() => {
      signOut.mockResolvedValue({ error: new AuthRetryableFetchError("fetch failed", 0) });
    });

    it("kasuje ciasteczko sesji, mimo że SDK tego nie zrobiło", async () => {
      const { POST } = await import("@/pages/api/auth/signout");
      const { context, deleted } = signoutRequest([TOKEN]);

      await POST(context);

      // Sedno naprawy. Bez tego user wychodzi z ŻYWĄ sesją w przeglądarce.
      expect(deleted()).toContain(TOKEN);
    });

    it("kasuje wszystkie fragmenty pociętego tokenu, nie tylko pierwszy", async () => {
      const { POST } = await import("@/pages/api/auth/signout");
      const { context, deleted } = signoutRequest([`${TOKEN}.0`, `${TOKEN}.1`]);

      await POST(context);

      // Supabase tnie token na ciasteczka `.0`, `.1`, ... (MAX_CHUNK_SIZE 3180).
      // Skasowanie tylko części zostawia sesję w stanie, którego nikt nie
      // testował — a `test-plan.md` §6.6 notuje realny incydent z pomieszanych
      // fragmentów („zalogowany na `/`, odbity z `/dashboard`").
      expect(deleted()).toEqual(expect.arrayContaining([`${TOKEN}.0`, `${TOKEN}.1`]));
    });

    it("NIE kasuje code verifiera PKCE", async () => {
      const { POST } = await import("@/pages/api/auth/signout");
      const { context, deleted } = signoutRequest([TOKEN, VERIFIER]);

      await POST(context);

      // Asercja negatywna pilnująca granicy helpera, nie tego endpointu.
      // Ten sam helper woła middleware, które biegnie TAKŻE po
      // `/api/auth/callback` — a tam skasowanie verifiera wywróciłoby
      // `exchangeCodeForSession` i zamieniło naprawę wylogowania w awarię
      // logowania. Kasujemy token sesji, nie wszystko po prefiksie `sb-`.
      expect(deleted()).not.toContain(VERIFIER);
    });

    it("nie rusza ciasteczek spoza Supabase", async () => {
      const { POST } = await import("@/pages/api/auth/signout");
      const { context, deleted } = signoutRequest([TOKEN, "theme", "consent"]);

      await POST(context);

      expect(deleted()).not.toContain("theme");
      expect(deleted()).not.toContain("consent");
    });

    it("zostawia ślad w logu serwera", async () => {
      const { POST } = await import("@/pages/api/auth/signout");
      const { context } = signoutRequest([TOKEN]);

      await POST(context);

      // Wylogowanie lokalne udało się, ale unieważnienie po stronie serwera NIE.
      // Refresh token żyje dalej — operator musi mieć jak to zobaczyć.
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError.mock.calls[0]?.[1]).toBeInstanceOf(AuthRetryableFetchError);
    });

    it("nadal przekierowuje na stronę główną", async () => {
      const { POST } = await import("@/pages/api/auth/signout");
      const { context, redirect } = signoutRequest([TOKEN]);

      await POST(context);

      // Decyzja produktowa (Marcin, 2026-08-10): fail safe BEZ zmiany UX.
      // User kliknął „wyloguj" i ma wyjść — straszenie go błędem przy
      // czynności, która z jego punktu widzenia się udała, nic nie wnosi.
      expect(redirect).toHaveBeenCalledWith("/");
    });
  });

  describe("gdy wylogowanie przechodzi normalnie", () => {
    beforeEach(() => {
      signOut.mockResolvedValue({ error: null });
    });

    it("nie hałasuje w logach", async () => {
      const { POST } = await import("@/pages/api/auth/signout");
      const { context, redirect } = signoutRequest([TOKEN]);

      await POST(context);

      // Ta sama bramka kosztowa co w middleware: wylogowanie to czynność
      // codzienna, więc ścieżka sukcesu musi być cicha.
      expect(consoleError).not.toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith("/");
    });
  });
});
