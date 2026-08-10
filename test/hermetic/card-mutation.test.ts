import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { APIContext } from "astro";

/**
 * Mutacje pojedynczej karty: `PUT` i `DELETE /api/cards/:id`.
 *
 * Trzy rzeczy, których ten plik pilnuje, i dlaczego akurat one:
 *
 * 1. **Cicha odmowa RLS nie może wyglądać jak sukces.** PostgREST na
 *    `UPDATE`/`DELETE` cudzego wiersza zwraca 200, `error: null` i zero wierszy
 *    (zmierzone w researchu do `testing-data-isolation`). Endpoint bez kontroli
 *    liczby trafionych wierszy odpowiedziałby `200 OK` na próbę skasowania
 *    cudzej karty. Że baza takiej próbie NIE ulega, dowodzi
 *    `test/integration/cards-isolation.test.ts` — tu sprawdzamy drugą połowę:
 *    czy aplikacja poprawnie tłumaczy „zero wierszy" na 404.
 *
 * 2. **FR-026** — edycja zmienia wyłącznie pytanie i/lub odpowiedź, harmonogram
 *    Leitnera zostaje nietknięty. Asercja idzie na ŁADUNEK przekazany do
 *    `update()`, nie na odpowiedź: żądanie z `leitner_box` może dostać
 *    poprawne 200 i mimo to przemycić zmianę harmonogramu.
 *
 * 3. **Ryzyko #2** — redakcja błędu bazy plus ref korelacyjny, tak samo jak
 *    w `POST /api/cards`. Nowy endpoint to nowa powierzchnia wycieku.
 *
 * Hermetycznie, bo stub podmienia GRANICĘ (klienta Supabase), a endpoint
 * wykonuje swoją realną ścieżkę. Warstwa własności zasobu jest sprawdzana
 * integracyjnie przeciw żywej bazie — mockowanie jej tutaj byłoby antywzorcem
 * wprost wymienionym w §Risk Response Guidance dla Ryzyka 4.
 */

// Kształt błędu zdjęty z żywej bazy, nie wymyślony — ten sam, którego używa
// `cards-error-redaction.test.ts`.
const REAL_DB_ERROR = {
  code: "23514",
  message: 'new row for relation "cards" violates check constraint "cards_source_check"',
  details: null,
  hint: null,
};

const VALID_ID = "11111111-2222-4333-8444-555555555555";
const OWNER = { id: "00000000-0000-0000-0000-000000000001" };

const updatePayload = vi.fn();
const updateResult = vi.fn();
const deleteResult = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: () => ({
      update: (patch: unknown) => {
        updatePayload(patch);
        return { eq: () => ({ select: () => ({ maybeSingle: updateResult }) }) };
      },
      delete: () => ({ eq: () => ({ select: () => ({ maybeSingle: deleteResult }) }) }),
    }),
  }),
}));

function mutationRequest(method: "PUT" | "DELETE", options: { body?: unknown; id?: string; signedIn?: boolean } = {}) {
  const { body, id = VALID_ID, signedIn = true } = options;

  return {
    locals: { user: signedIn ? OWNER : null },
    params: { id },
    request: new Request(`http://localhost/api/cards/${id}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    }),
    cookies: {},
  } as unknown as APIContext;
}

async function route() {
  return await import("@/pages/api/cards/[id]");
}

/** Karta, jaką baza zwraca po udanej mutacji — pełny wiersz, nie sam patch. */
const STORED_CARD = {
  id: VALID_ID,
  user_id: OWNER.id,
  question: "Nowe pytanie",
  answer: "Nowa odpowiedź",
  source: "manual",
  generation_id: null,
  leitner_box: 3,
  next_review_at: "2026-09-01T10:00:00.000Z",
  created_at: "2026-08-01T10:00:00.000Z",
  updated_at: "2026-08-10T10:00:00.000Z",
};

describe("PUT /api/cards/:id", () => {
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    updateResult.mockResolvedValue({ data: STORED_CARD, error: null });
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    updatePayload.mockClear();
  });

  describe("bramka dostępu", () => {
    it("odrzuca żądanie bez sesji, mimo że trasa nie jest w PROTECTED_ROUTES", async () => {
      const { PUT } = await route();

      const response = await PUT(mutationRequest("PUT", { body: { question: "x" }, signedIn: false }));

      expect(response.status).toBe(401);
    });

    it("nie dotyka bazy, gdy sesji nie ma", async () => {
      const { PUT } = await route();

      await PUT(mutationRequest("PUT", { body: { question: "x" }, signedIn: false }));

      // Bez tej asercji 401 mógłby wracać PO wykonaniu zapisu.
      expect(updatePayload).not.toHaveBeenCalled();
    });

    it("odrzuca identyfikator, który nie jest UUID", async () => {
      const { PUT } = await route();

      const response = await PUT(mutationRequest("PUT", { body: { question: "x" }, id: "../../etc/passwd" }));

      expect(response.status).toBe(400);
      expect(updatePayload).not.toHaveBeenCalled();
    });
  });

  describe("walidacja treści", () => {
    it("odrzuca puste pytanie", async () => {
      const { PUT } = await route();

      const response = await PUT(mutationRequest("PUT", { body: { question: "   " } }));

      expect(response.status).toBe(422);
    });

    it("odrzuca żądanie bez żadnego pola do zmiany", async () => {
      const { PUT } = await route();

      const response = await PUT(mutationRequest("PUT", { body: {} }));

      // Bez `refine` pusty patch przeszedłby walidację i wykonał zapis bez
      // zmian, zwracając 200 — użytkownik dostałby potwierdzenie edycji,
      // której nie było.
      expect(response.status).toBe(422);
      expect(updatePayload).not.toHaveBeenCalled();
    });

    it("odrzuca niepoprawny JSON", async () => {
      const { PUT } = await route();

      const response = await PUT(mutationRequest("PUT", { body: "{nie-json" }));

      expect(response.status).toBe(400);
    });

    it("przyjmuje edycję samej odpowiedzi", async () => {
      const { PUT } = await route();

      const response = await PUT(mutationRequest("PUT", { body: { answer: "Sama odpowiedź" } }));

      // FR-025 mówi „question and/or answer" — edycja jednego pola musi być legalna.
      expect(response.status).toBe(200);
    });
  });

  describe("FR-026 — edycja nie rusza harmonogramu", () => {
    it("przekazuje do bazy wyłącznie pytanie i odpowiedź", async () => {
      const { PUT } = await route();

      await PUT(
        mutationRequest("PUT", {
          body: {
            question: "Nowe pytanie",
            answer: "Nowa odpowiedź",
            leitner_box: 5,
            next_review_at: "2099-01-01T00:00:00.000Z",
            user_id: "99999999-9999-4999-8999-999999999999",
            source: "ai",
          },
        }),
      );

      // Asercja na ładunek, nie na kod odpowiedzi: przemycone pole dałoby
      // poprawne 200 i po cichu przesunęło kartę w drabinie powtórek.
      expect(updatePayload).toHaveBeenCalledWith({ question: "Nowe pytanie", answer: "Nowa odpowiedź" });
    });

    it("odrzuca żądanie, w którym JEDYNYM polem jest harmonogram", async () => {
      const { PUT } = await route();

      const response = await PUT(mutationRequest("PUT", { body: { leitner_box: 1, next_review_at: "2099-01-01" } }));

      // Po odsianiu nieznanych pól zostaje pusty patch — 422, nie cichy no-op.
      expect(response.status).toBe(422);
      expect(updatePayload).not.toHaveBeenCalled();
    });
  });

  describe("gdy mutacja nie trafia w żaden wiersz", () => {
    beforeEach(() => {
      // Dokładny kształt cichej odmowy RLS: 200, brak błędu, zero wierszy.
      updateResult.mockResolvedValue({ data: null, error: null });
    });

    it("zwraca 404, a nie 200", async () => {
      const { PUT } = await route();

      const response = await PUT(mutationRequest("PUT", { body: { question: "PWNED" } }));

      expect(response.status).toBe(404);
    });

    it("nie zdradza w treści, czy karta nie istnieje, czy należy do kogoś innego", async () => {
      const { PUT } = await route();

      const response = await PUT(mutationRequest("PUT", { body: { question: "PWNED" } }));
      const body = await response.text();

      // Rozróżnienie pozwoliłoby sondować, które identyfikatory istnieją
      // w cudzych bibliotekach.
      for (const leak of ["forbidden", "owner", "permission", "denied", "rls"]) {
        expect(body.toLowerCase()).not.toContain(leak);
      }
    });
  });

  describe("gdy baza zwraca błąd", () => {
    beforeEach(() => {
      updateResult.mockResolvedValue({ data: null, error: REAL_DB_ERROR });
    });

    it("nie ujawnia klientowi wnętrzności bazy", async () => {
      const { PUT } = await route();

      const response = await PUT(mutationRequest("PUT", { body: { question: "x" } }));
      const body = await response.text();

      expect(response.status).toBe(500);
      for (const leak of ["constraint", "violates", "23514", "relation"]) {
        expect(body.toLowerCase()).not.toContain(leak.toLowerCase());
      }
    });

    it("łączy odpowiedź z logiem tym samym refem", async () => {
      const { PUT } = await route();

      const response = await PUT(mutationRequest("PUT", { body: { question: "x" } }));
      const payload = (await response.json()) as { error: string };

      const match = /Support reference: ([0-9a-f-]{36})/.exec(payload.error);
      expect(match).not.toBeNull();

      const ref = match?.[1] ?? "";
      expect(ref).not.toBe("");
      expect(JSON.stringify(consoleError.mock.calls)).toContain(ref);
    });
  });

  it("zwraca zaktualizowaną kartę po udanym zapisie", async () => {
    const { PUT } = await route();

    const response = await PUT(mutationRequest("PUT", { body: { question: "Nowe pytanie" } }));
    const payload = (await response.json()) as { id: string; question: string };

    expect(response.status).toBe(200);
    expect(payload.id).toBe(VALID_ID);
    expect(payload.question).toBe("Nowe pytanie");
  });
});

describe("DELETE /api/cards/:id", () => {
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    deleteResult.mockResolvedValue({ data: STORED_CARD, error: null });
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("odrzuca żądanie bez sesji", async () => {
    const { DELETE } = await route();

    const response = await DELETE(mutationRequest("DELETE", { signedIn: false }));

    expect(response.status).toBe(401);
  });

  it("odrzuca identyfikator, który nie jest UUID", async () => {
    const { DELETE } = await route();

    const response = await DELETE(mutationRequest("DELETE", { id: "42" }));

    expect(response.status).toBe(400);
  });

  it("zwraca 404, gdy nie skasowano żadnego wiersza", async () => {
    deleteResult.mockResolvedValue({ data: null, error: null });
    const { DELETE } = await route();

    const response = await DELETE(mutationRequest("DELETE"));

    // Ta asercja jest sednem endpointu. Bez niej próba skasowania cudzej karty
    // kończy się `200 OK`, a UI usuwa ją z listy mimo że rekord żyje.
    expect(response.status).toBe(404);
  });

  it("potwierdza tożsamość skasowanej karty", async () => {
    const { DELETE } = await route();

    const response = await DELETE(mutationRequest("DELETE"));
    const payload = (await response.json()) as { id: string };

    expect(response.status).toBe(200);
    expect(payload.id).toBe(VALID_ID);
  });

  it("redaguje błąd bazy i zostawia ref w logu", async () => {
    deleteResult.mockResolvedValue({ data: null, error: REAL_DB_ERROR });
    const { DELETE } = await route();

    const response = await DELETE(mutationRequest("DELETE"));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(payload.error).not.toContain("23514");

    const match = /Support reference: ([0-9a-f-]{36})/.exec(payload.error);
    expect(match).not.toBeNull();
    expect(JSON.stringify(consoleError.mock.calls)).toContain(match?.[1] ?? "");
  });
});
