import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { APIContext } from "astro";

/**
 * `POST /api/generations/:id/approve` — trzy rzeczy, których ten plik pilnuje:
 *
 * 1. **Odmowa RLS na SELECT wygląda jak brak wiersza**, nie jak błąd — dokładnie
 *    ten sam kształt co w `card-mutation.test.ts` dla UPDATE/DELETE. `maybeSingle`
 *    zwraca `{data: null, error: null}` dla cudzego `generation_id`, endpoint
 *    musi to przełożyć na 404, nie na 200/500.
 * 2. **Limity treści z `generation.ts`** (`CARD_FIELD_MAX_LENGTH`,
 *    `EXPECTED_CARD_COUNT`) są egzekwowane na warstwie Zod route'a, nie tylko
 *    w serwisie generacji — approve przyjmuje edytowaną/zredukowaną listę od
 *    klienta, więc to jedyne miejsce, które ją jeszcze waliduje przed zapisem.
 * 3. **Redakcja błędu bazy + ref korelacyjny**, ten sam wzorzec co w
 *    `cards-error-redaction.test.ts` — nowy endpoint to nowa powierzchnia wycieku.
 *
 * Stub podmienia GRANICĘ (`@/lib/supabase`), endpoint wykonuje swoją realną
 * ścieżkę. Własność zasobu przeciw żywej bazie jest poza zakresem tego pliku —
 * to rola testów integracyjnych (patrz `cards-isolation.test.ts`), tu sprawdzamy
 * tylko czy aplikacja poprawnie tłumaczy kształty odpowiedzi Supabase na status HTTP.
 */

const REAL_DB_ERROR = {
  code: "23503",
  message: 'insert or update on table "cards" violates foreign key constraint "cards_generation_id_fkey"',
  details: null,
  hint: null,
};

const VALID_GENERATION_ID = "11111111-2222-4333-8444-555555555555";
const OWNER = { id: "00000000-0000-0000-0000-000000000001" };

const lookupEq = vi.fn();
const lookupResult = vi.fn();
const insertPayload = vi.fn();
const insertResult = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "generations") {
        return {
          select: () => ({
            eq: (...args: unknown[]) => {
              lookupEq(...args);
              return { maybeSingle: lookupResult };
            },
          }),
        };
      }
      return {
        insert: (payload: unknown) => {
          insertPayload(payload);
          return { select: insertResult };
        },
      };
    },
  }),
}));

function approveRequest(options: { body?: unknown; id?: string; signedIn?: boolean } = {}): APIContext {
  const { body, id = VALID_GENERATION_ID, signedIn = true } = options;
  return {
    locals: { user: signedIn ? OWNER : null },
    params: { id },
    request: new Request(`http://localhost/api/generations/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    }),
    cookies: {},
  } as unknown as APIContext;
}

async function route() {
  return await import("@/pages/api/generations/[id]/approve");
}

const ONE_CARD = [{ question: "Q1", answer: "A1" }];
const SIX_CARDS = Array.from({ length: 6 }, (_, i) => ({ question: `Q${String(i)}`, answer: `A${String(i)}` }));

const STORED_CARDS = [
  {
    id: "22222222-3333-4444-8555-666666666666",
    user_id: OWNER.id,
    question: "Q1",
    answer: "A1",
    source: "ai",
    generation_id: VALID_GENERATION_ID,
    leitner_box: 1,
    next_review_at: "2026-08-13T10:00:00.000Z",
    created_at: "2026-08-13T10:00:00.000Z",
    updated_at: "2026-08-13T10:00:00.000Z",
  },
];

describe("POST /api/generations/:id/approve", () => {
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    lookupResult.mockResolvedValue({ data: { id: VALID_GENERATION_ID }, error: null });
    insertResult.mockResolvedValue({ data: STORED_CARDS, error: null });
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    lookupEq.mockClear();
    insertPayload.mockClear();
  });

  describe("bramka dostępu i walidacji", () => {
    it("odrzuca żądanie bez sesji", async () => {
      const { POST } = await route();

      const response = await POST(approveRequest({ body: { cards: ONE_CARD }, signedIn: false }));

      expect(response.status).toBe(401);
      expect(insertPayload).not.toHaveBeenCalled();
    });

    it("odrzuca identyfikator generacji, który nie jest UUID", async () => {
      const { POST } = await route();

      const response = await POST(approveRequest({ body: { cards: ONE_CARD }, id: "not-a-uuid" }));

      expect(response.status).toBe(400);
      expect(insertPayload).not.toHaveBeenCalled();
    });

    it("odrzuca niepoprawny JSON", async () => {
      const { POST } = await route();

      const response = await POST(approveRequest({ body: "{nie-json" }));

      expect(response.status).toBe(400);
    });

    it("odrzuca pustą listę kart", async () => {
      const { POST } = await route();

      const response = await POST(approveRequest({ body: { cards: [] } }));

      expect(response.status).toBe(422);
      expect(insertPayload).not.toHaveBeenCalled();
    });

    it("odrzuca listę dłuższą niż EXPECTED_CARD_COUNT (6 kart)", async () => {
      const { POST } = await route();

      const response = await POST(approveRequest({ body: { cards: SIX_CARDS } }));

      expect(response.status).toBe(422);
      expect(insertPayload).not.toHaveBeenCalled();
    });

    it("odrzuca kartę z pytaniem dłuższym niż 500 znaków", async () => {
      const { POST } = await route();

      const response = await POST(approveRequest({ body: { cards: [{ question: "x".repeat(501), answer: "A1" }] } }));

      expect(response.status).toBe(422);
      expect(insertPayload).not.toHaveBeenCalled();
    });
  });

  describe("gdy generacja nie istnieje lub należy do kogoś innego", () => {
    beforeEach(() => {
      // Cicha odmowa RLS: 200-równoważne `{data: null, error: null}`, ten sam
      // kształt co przy UPDATE/DELETE cudzej karty.
      lookupResult.mockResolvedValue({ data: null, error: null });
    });

    it("zwraca 404, a nie 500 ani ciche 201", async () => {
      const { POST } = await route();

      const response = await POST(approveRequest({ body: { cards: ONE_CARD } }));

      expect(response.status).toBe(404);
      expect(insertPayload).not.toHaveBeenCalled();
    });
  });

  describe("gdy baza zwraca błąd", () => {
    it("błąd przy SELECT generacji redaguje szczegóły i zwraca ref", async () => {
      lookupResult.mockResolvedValue({ data: null, error: REAL_DB_ERROR });
      const { POST } = await route();

      const response = await POST(approveRequest({ body: { cards: ONE_CARD } }));
      const payload = (await response.json()) as { error: string };

      expect(response.status).toBe(500);
      expect(payload.error).not.toContain("23503");
      expect(payload.error).not.toContain("constraint");
      const match = /Support reference: ([0-9a-f-]{36})/.exec(payload.error);
      expect(match).not.toBeNull();
      expect(JSON.stringify(consoleError.mock.calls)).toContain(match?.[1] ?? "");
    });

    it("błąd przy INSERT kart redaguje szczegóły i zwraca ref", async () => {
      insertResult.mockResolvedValue({ data: null, error: REAL_DB_ERROR });
      const { POST } = await route();

      const response = await POST(approveRequest({ body: { cards: ONE_CARD } }));
      const payload = (await response.json()) as { error: string };

      expect(response.status).toBe(500);
      expect(payload.error).not.toContain("23503");
      const match = /Support reference: ([0-9a-f-]{36})/.exec(payload.error);
      expect(match).not.toBeNull();
      expect(JSON.stringify(consoleError.mock.calls)).toContain(match?.[1] ?? "");
    });
  });

  it("zapisuje karty z source:'ai' i poprawnym generation_id, zwraca 201 z wierszami", async () => {
    const { POST } = await route();

    const response = await POST(approveRequest({ body: { cards: ONE_CARD } }));
    const payload = (await response.json()) as { cards: (typeof STORED_CARDS)[number][] };

    expect(response.status).toBe(201);
    expect(insertPayload).toHaveBeenCalledWith([
      { question: "Q1", answer: "A1", user_id: OWNER.id, source: "ai", generation_id: VALID_GENERATION_ID },
    ]);
    expect(payload.cards).toEqual(STORED_CARDS);
    expect(payload.cards[0].source).toBe("ai");
    expect(payload.cards[0].generation_id).toBe(VALID_GENERATION_ID);
  });
});
