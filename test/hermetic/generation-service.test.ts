import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createClient } from "@/lib/supabase";
import { OpenRouterNetworkError } from "@/lib/openrouter";

/**
 * `generateFlashcards` orkiestruje sieć (OpenRouter) i bazę (`generations`).
 * Granica mockowana tu to `@/lib/openrouter` — Supabase nie jest mockowany
 * modułowo, bo funkcja przyjmuje klienta jako parametr wprost (nie woła
 * `createClient` sama), więc wystarczy podać obiekt o właściwym kształcie.
 *
 * Kluczowa asercja negatywna w tym pliku: przy błędzie (sieciowym albo
 * walidacji odpowiedzi AI) `generations` NIE dostaje wiersza — patrz
 * plan.md, "Critical Implementation Details": nieudana próba nie zostawia
 * śladu poza błędem widocznym userowi.
 */

const requestChatCompletionMock = vi.fn<(...args: unknown[]) => Promise<string>>();

vi.mock("@/lib/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/openrouter")>();
  return {
    ...actual,
    requestChatCompletion: (...args: unknown[]) => requestChatCompletionMock(...args),
  };
});

async function service() {
  return await import("@/lib/services/generation");
}

const insertPayload = vi.fn();
const insertResult = vi.fn();

function fakeSupabase(): NonNullable<ReturnType<typeof createClient>> {
  return {
    from: () => ({
      insert: (payload: unknown) => {
        insertPayload(payload);
        return { select: () => ({ single: insertResult }) };
      },
    }),
  } as unknown as NonNullable<ReturnType<typeof createClient>>;
}

const USER_ID = "00000000-0000-0000-0000-000000000001";
const SOURCE_TEXT = "x".repeat(500);
const API_KEY = "test-key";

function validFlashcardsResponse(): string {
  const flashcards = Array.from({ length: 5 }, (_, i) => ({
    question: `Pytanie ${(i + 1).toString()}?`,
    answer: `Odpowiedź ${(i + 1).toString()}.`,
  }));
  return JSON.stringify({ flashcards });
}

describe("generateFlashcards", () => {
  beforeEach(() => {
    insertPayload.mockClear();
    insertResult.mockReset();
  });

  afterEach(() => {
    requestChatCompletionMock.mockReset();
  });

  it("przy sukcesie zapisuje wiersz generations z poprawnym hashem/długością i zwraca kandydatów", async () => {
    requestChatCompletionMock.mockResolvedValue(validFlashcardsResponse());
    insertResult.mockResolvedValue({ data: { id: "generation-id", user_id: USER_ID }, error: null });
    const { generateFlashcards, hashSourceText } = await service();

    const result = await generateFlashcards(fakeSupabase(), USER_ID, SOURCE_TEXT, API_KEY);

    expect(result.generationId).toBe("generation-id");
    expect(result.candidates).toHaveLength(5);

    const expectedHash = await hashSourceText(SOURCE_TEXT);
    expect(insertPayload).toHaveBeenCalledWith({
      user_id: USER_ID,
      source_text_hash: expectedHash,
      source_text_length: SOURCE_TEXT.length,
    });
  });

  it("błąd OpenRoutera propaguje się i NIE zapisuje wiersza generations", async () => {
    requestChatCompletionMock.mockRejectedValue(new OpenRouterNetworkError("timeout"));
    const { generateFlashcards } = await service();

    await expect(generateFlashcards(fakeSupabase(), USER_ID, SOURCE_TEXT, API_KEY)).rejects.toBeInstanceOf(
      OpenRouterNetworkError,
    );
    expect(insertPayload).not.toHaveBeenCalled();
    expect(insertResult).not.toHaveBeenCalled();
  });

  it("niepoprawna odpowiedź AI (GenerationValidationError) propaguje się i NIE zapisuje wiersza generations", async () => {
    requestChatCompletionMock.mockResolvedValue(JSON.stringify({ flashcards: [{ question: "tylko jedna" }] }));
    const { generateFlashcards, GenerationValidationError } = await service();

    await expect(generateFlashcards(fakeSupabase(), USER_ID, SOURCE_TEXT, API_KEY)).rejects.toBeInstanceOf(
      GenerationValidationError,
    );
    expect(insertPayload).not.toHaveBeenCalled();
    expect(insertResult).not.toHaveBeenCalled();
  });
});
