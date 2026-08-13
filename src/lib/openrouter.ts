import { z } from "zod";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const AI_MODEL = "openai/gpt-4o-mini";
const MAX_ATTEMPTS = 2;
const ATTEMPT_TIMEOUT_MS = 12_000;
const RETRY_DELAY_MS = 3_000;

export class OpenRouterError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "OpenRouterError";
    this.code = code;
  }
}

export class OpenRouterAuthError extends OpenRouterError {
  constructor(message = "OpenRouter authentication failed") {
    super(message, "AUTH_ERROR");
    this.name = "OpenRouterAuthError";
  }
}

export class OpenRouterRateLimitError extends OpenRouterError {
  constructor(message = "OpenRouter rate limit exceeded") {
    super(message, "RATE_LIMIT");
    this.name = "OpenRouterRateLimitError";
  }
}

export class OpenRouterNetworkError extends OpenRouterError {
  constructor(message = "OpenRouter request failed") {
    super(message, "NETWORK_ERROR");
    this.name = "OpenRouterNetworkError";
  }
}

export class OpenRouterProtocolError extends OpenRouterError {
  readonly statusCode?: number;

  constructor(message = "OpenRouter returned an unexpected response", statusCode?: number) {
    super(message, "PROTOCOL_ERROR");
    this.name = "OpenRouterProtocolError";
    this.statusCode = statusCode;
  }
}

const chatCompletionResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

interface RequestChatCompletionParams {
  apiKey: string;
  systemPrompt: string;
  userMessage: string;
  jsonSchema: Record<string, unknown>;
}

/**
 * Bramka na retry: FR-027 wymaga twardego limitu 30s, a to jest jedyna funkcja,
 * która wie ile prób i ile timeoutu zostało zużyte. `AuthError`/`ProtocolError`
 * nie są tymczasowe — retry na nich tylko wydłużyłby czekanie na ten sam wynik.
 */
export async function requestChatCompletion(params: RequestChatCompletionParams): Promise<string> {
  let lastError: OpenRouterError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await performRequest(params);
    } catch (error) {
      if (!(error instanceof OpenRouterError)) {
        throw error;
      }
      if (error instanceof OpenRouterAuthError || error instanceof OpenRouterProtocolError) {
        throw error;
      }
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw lastError ?? new OpenRouterNetworkError("OpenRouter request failed after retries");
}

async function performRequest(params: RequestChatCompletionParams): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, ATTEMPT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: params.systemPrompt },
          { role: "user", content: params.userMessage },
        ],
        temperature: 0.7,
        max_tokens: 2000,
        response_format: {
          type: "json_schema",
          json_schema: { name: "flashcards_response", strict: true, schema: params.jsonSchema },
        },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    // Obejmuje też AbortError z timeoutu — z perspektywy wołającego to ten sam,
    // tymczasowy stan co 5xx: warto spróbować ponownie.
    throw new OpenRouterNetworkError(error instanceof Error ? error.message : "Network request failed");
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 401) {
    throw new OpenRouterAuthError();
  }
  if (response.status === 429) {
    throw new OpenRouterRateLimitError();
  }
  if (response.status >= 500) {
    throw new OpenRouterNetworkError(`OpenRouter returned ${response.status}`);
  }
  if (!response.ok) {
    throw new OpenRouterProtocolError(`OpenRouter returned ${response.status}`, response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new OpenRouterProtocolError("OpenRouter response was not valid JSON");
  }

  const parsed = chatCompletionResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new OpenRouterProtocolError("OpenRouter response had an unexpected shape");
  }

  return parsed.data.choices[0].message.content;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
