import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { APIContext } from "astro";
import {
  OpenRouterAuthError,
  OpenRouterNetworkError,
  OpenRouterProtocolError,
  OpenRouterRateLimitError,
} from "@/lib/openrouter";
import { GenerationValidationError, type FlashcardCandidate } from "@/lib/services/generation";

/**
 * `POST /api/generations`: bramka auth/walidacji + tabela mapowania błędów na
 * kody statusu (plan.md Faza 3). Granica mockowana to `@/lib/services/generation`
 * w całości (`generateFlashcards` podmieniony, reszta — stałe, klasy błędów —
 * prawdziwa przez `importOriginal`, bo schemat Zod w route potrzebuje realnych
 * `SOURCE_TEXT_MIN_LENGTH`/`MAX_LENGTH` przy imporcie modułu) oraz
 * `astro:env/server`, żeby dało się osobno przetestować ścieżkę brakującego klucza.
 */

const generateFlashcardsMock =
  vi.fn<(...args: unknown[]) => Promise<{ generationId: string; candidates: FlashcardCandidate[] }>>();

vi.mock("@/lib/services/generation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/generation")>();
  return {
    ...actual,
    generateFlashcards: (...args: unknown[]) => generateFlashcardsMock(...args),
  };
});

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({}),
}));

interface EnvState {
  OPENROUTER_API_KEY: string | undefined;
}

const envState = vi.hoisted((): EnvState => ({ OPENROUTER_API_KEY: "test-key" }));
vi.mock("astro:env/server", () => envState);

const OWNER = { id: "00000000-0000-0000-0000-000000000001" };
const VALID_TEXT = "x".repeat(500);

function request(options: { body?: unknown; signedIn?: boolean } = {}): APIContext {
  const { body, signedIn = true } = options;
  return {
    locals: { user: signedIn ? OWNER : null },
    request: new Request("http://localhost/api/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    }),
    cookies: {},
  } as unknown as APIContext;
}

async function route() {
  return await import("@/pages/api/generations");
}

describe("POST /api/generations", () => {
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    generateFlashcardsMock.mockReset();
    envState.OPENROUTER_API_KEY = "test-key";
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("bramka dostępu i walidacji", () => {
    it("odrzuca żądanie bez sesji", async () => {
      const { POST } = await route();

      const response = await POST(request({ body: { source_text: VALID_TEXT }, signedIn: false }));

      expect(response.status).toBe(401);
      expect(generateFlashcardsMock).not.toHaveBeenCalled();
    });

    it("odrzuca niepoprawny JSON", async () => {
      const { POST } = await route();

      const response = await POST(request({ body: "{nie-json" }));

      expect(response.status).toBe(400);
      expect(generateFlashcardsMock).not.toHaveBeenCalled();
    });

    it("odrzuca tekst krótszy niż 500 znaków", async () => {
      const { POST } = await route();

      const response = await POST(request({ body: { source_text: "x".repeat(499) } }));

      expect(response.status).toBe(422);
      expect(generateFlashcardsMock).not.toHaveBeenCalled();
    });

    it("odrzuca tekst dłuższy niż 5000 znaków", async () => {
      const { POST } = await route();

      const response = await POST(request({ body: { source_text: "x".repeat(5001) } }));

      expect(response.status).toBe(422);
      expect(generateFlashcardsMock).not.toHaveBeenCalled();
    });

    it("zwraca 503, gdy OPENROUTER_API_KEY nie jest skonfigurowany", async () => {
      envState.OPENROUTER_API_KEY = undefined;
      const { POST } = await route();

      const response = await POST(request({ body: { source_text: VALID_TEXT } }));

      expect(response.status).toBe(503);
      expect(generateFlashcardsMock).not.toHaveBeenCalled();
    });
  });

  describe("mapowanie błędów generateFlashcards na status", () => {
    it.each([
      { name: "OpenRouterAuthError", error: () => new OpenRouterAuthError(), status: 503 },
      { name: "OpenRouterRateLimitError", error: () => new OpenRouterRateLimitError(), status: 504 },
      { name: "OpenRouterNetworkError", error: () => new OpenRouterNetworkError(), status: 504 },
      { name: "OpenRouterProtocolError", error: () => new OpenRouterProtocolError(), status: 502 },
      { name: "GenerationValidationError", error: () => new GenerationValidationError("złe dane"), status: 502 },
      { name: "błąd nieoczekiwany (Error)", error: () => new Error("db exploded"), status: 500 },
    ])("$name → $status", async ({ error, status }) => {
      generateFlashcardsMock.mockRejectedValue(error());
      const { POST } = await route();

      const response = await POST(request({ body: { source_text: VALID_TEXT } }));

      expect(response.status).toBe(status);
    });

    it("503/500 dołączają ref korelacyjny widoczny też w logu", async () => {
      generateFlashcardsMock.mockRejectedValue(new OpenRouterAuthError());
      const { POST } = await route();

      const response = await POST(request({ body: { source_text: VALID_TEXT } }));
      const payload = (await response.json()) as { error: string };

      const match = /Support reference: ([0-9a-f-]{36})/.exec(payload.error);
      expect(match).not.toBeNull();
      expect(JSON.stringify(consoleError.mock.calls)).toContain(match?.[1] ?? "");
    });
  });

  it("zwraca 201 z generation_id i kandydatami przy sukcesie", async () => {
    generateFlashcardsMock.mockResolvedValue({
      generationId: "11111111-2222-4333-8444-555555555555",
      candidates: [{ question: "Q1", answer: "A1" }],
    });
    const { POST } = await route();

    const response = await POST(request({ body: { source_text: VALID_TEXT } }));
    const payload = (await response.json()) as { generation_id: string; cards: unknown[] };

    expect(response.status).toBe(201);
    expect(payload.generation_id).toBe("11111111-2222-4333-8444-555555555555");
    expect(payload.cards).toEqual([{ question: "Q1", answer: "A1" }]);
  });
});
