import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { APIContext } from "astro";

/**
 * Ryzyko #2, twarz pierwsza: surowy błąd bazy w odpowiedzi API.
 *
 * Jedyne ryzyko tego rolloutu z POTWIERDZONYM precedensem: endpoint zwracał
 * `error.message` z bazy wprost do klienta
 * (context/archive/2026-06-09-db-schema-mvp/reviews/impl-review.md §F5).
 * Naprawione, ale nieobwarowane testem — do teraz.
 *
 * Dlaczego hermetycznie, a nie integracyjnie: `createCardSchema` to `z.object`
 * bez `.strict()`, więc zod usuwa nieznane pola i do `insert()` trafiają tylko
 * `question`, `answer` i `user_id` z sesji. Nie istnieje legalne żądanie HTTP,
 * które doprowadziłoby do naruszenia CHECK-a — gałąź `if (error)` jest
 * osiągalna wyłącznie przy awarii infrastruktury (research.md §B1). Test
 * integracyjny musiałby wymuszać stan, którego produkcja nie osiąga.
 *
 * Stub podmienia GRANICĘ (klienta Supabase), nie moduł endpointu — endpoint
 * wykonuje swoją realną ścieżkę błędu.
 */

// Kształt błędu zdjęty z żywej bazy podczas researchu, nie wymyślony.
const REAL_DB_ERROR = {
  code: "23514",
  message: 'new row for relation "cards" violates check constraint "cards_source_check"',
  details: null,
  hint: null,
};

const insertFails = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: () => ({
      insert: () => ({
        select: () => ({
          single: insertFails,
        }),
      }),
    }),
  }),
}));

function postCardRequest(): APIContext {
  return {
    locals: { user: { id: "00000000-0000-0000-0000-000000000001" } },
    request: new Request("http://localhost/api/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Pytanie", answer: "Odpowiedź" }),
    }),
    cookies: {},
  } as unknown as APIContext;
}

describe("redakcja błędu bazy w POST /api/cards", () => {
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    insertFails.mockResolvedValue({ data: null, error: REAL_DB_ERROR });
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("nie ujawnia klientowi wnętrzności bazy, gdy zapis padnie", async () => {
    const { POST } = await import("@/pages/api/cards");

    const response = await POST(postCardRequest());
    const body = await response.text();

    expect(response.status).toBe(500);

    // Asercja NEGATYWNA na listę ciągów, nie porównanie z aktualną treścią
    // komunikatu. Skopiowanie oczekiwanej wartości z implementacji dałoby
    // test-lustro: przechodziłby również wtedy, gdyby ktoś zmienił komunikat
    // z powrotem na surowy błąd bazy.
    for (const leak of ["cards", "constraint", "violates", "23514", "relation", "check"]) {
      expect(body.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });

  it("nie gubi informacji — surowy błąd trafia do logu serwera", async () => {
    const { POST } = await import("@/pages/api/cards");

    await POST(postCardRequest());

    // Druga połowa naprawy F5: redakcja ma przenieść szczegóły do logu, a nie
    // je skasować. Bez tej asercji „poprawka" polegająca na cichym połknięciu
    // błędu też przeszłaby test.
    expect(consoleError).toHaveBeenCalled();
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("23514");
  });

  it("zwraca ciało w formacie JSON z polem error jako tekstem", async () => {
    const { POST } = await import("@/pages/api/cards");

    const response = await POST(postCardRequest());
    const payload = (await response.json()) as { error?: unknown };

    // Kontrakt dla klienta: `error` musi być stringiem, inaczej formularz
    // renderuje obiekt jako React child i wyspa pada (§F2 w tym samym raporcie).
    expect(typeof payload.error).toBe("string");
  });
});
