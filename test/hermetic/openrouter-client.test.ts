import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpenRouterAuthError,
  OpenRouterNetworkError,
  OpenRouterProtocolError,
  OpenRouterRateLimitError,
  requestChatCompletion,
} from "@/lib/openrouter";

/**
 * To jest jedyny plik testujący `openrouter.ts` bezpośrednio — wszędzie indziej
 * moduł jest GRANICĄ mockowaną przez `vi.mock("@/lib/openrouter")`, tak jak
 * `@/lib/supabase` jest mockowane w testach route'ów. Tutaj testujemy samą
 * granicę, więc `vi.stubGlobal("fetch", ...)` jest właściwym narzędziem, a nie
 * obejściem konwencji.
 */

const PARAMS = {
  apiKey: "test-key",
  systemPrompt: "system",
  userMessage: "user",
  jsonSchema: { type: "object" },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const VALID_BODY = { choices: [{ message: { content: "raw content" } }] };

describe("requestChatCompletion", () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("zwraca treść wiadomości przy sukcesie", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, VALID_BODY));

    const content = await requestChatCompletion(PARAMS);

    expect(content).toBe("raw content");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("401 rzuca OpenRouterAuthError bez retry", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }));

    await expect(requestChatCompletion(PARAMS)).rejects.toBeInstanceOf(OpenRouterAuthError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("429 na pierwszej próbie, sukces na drugiej — dwa wywołania fetch", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: "rate limited" }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, VALID_BODY));

    const promise = requestChatCompletion(PARAMS);
    // Budżet retry z planu: 3000ms stałego opóźnienia między próbami.
    await vi.advanceTimersByTimeAsync(3000);
    const content = await promise;

    expect(content).toBe("raw content");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("429 dwa razy z rzędu rzuca OpenRouterRateLimitError po dokładnie dwóch próbach", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: "rate limited" }));

    // Asercja `.rejects` musi zaczepić handler na promisie ZANIM przesuniemy
    // zegar — inaczej odrzucenie nastąpi bez podpiętego handlera (rejection
    // trafia jako "unhandled" w tym samym ticku, w którym advanceTimersByTimeAsync
    // je wywołuje) i Vitest zgłasza ostrzeżenie, mimo że test i tak przechodzi.
    const promise = requestChatCompletion(PARAMS);
    const assertion = expect(promise).rejects.toBeInstanceOf(OpenRouterRateLimitError);
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("timeout/abort mapuje się na OpenRouterNetworkError", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    fetchMock.mockRejectedValue(abortError);

    const promise = requestChatCompletion(PARAMS);
    const assertion = expect(promise).rejects.toBeInstanceOf(OpenRouterNetworkError);
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });

  it("nieznany status non-2xx rzuca OpenRouterProtocolError bez retry", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: "bad request" }));

    await expect(requestChatCompletion(PARAMS)).rejects.toBeInstanceOf(OpenRouterProtocolError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("odpowiedź 2xx o niepoprawnym kształcie rzuca OpenRouterProtocolError", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { choices: [] }));

    await expect(requestChatCompletion(PARAMS)).rejects.toBeInstanceOf(OpenRouterProtocolError);
  });
});
