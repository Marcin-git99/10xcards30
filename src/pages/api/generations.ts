import type { APIRoute } from "astro";
import { z } from "zod";
import { OPENROUTER_API_KEY } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { logServerError } from "@/lib/api-error";
import {
  generateFlashcards,
  GenerationValidationError,
  SOURCE_TEXT_MAX_LENGTH,
  SOURCE_TEXT_MIN_LENGTH,
} from "@/lib/services/generation";
import {
  OpenRouterAuthError,
  OpenRouterNetworkError,
  OpenRouterProtocolError,
  OpenRouterRateLimitError,
} from "@/lib/openrouter";

export const prerender = false;

const generateRequestSchema = z.object({
  source_text: z
    .string()
    .trim()
    .min(SOURCE_TEXT_MIN_LENGTH, `Source text must be at least ${String(SOURCE_TEXT_MIN_LENGTH)} characters`)
    .max(SOURCE_TEXT_MAX_LENGTH, `Source text must be at most ${String(SOURCE_TEXT_MAX_LENGTH)} characters`),
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const result = generateRequestSchema.safeParse(body);
  if (!result.success) {
    return json({ error: z.flattenError(result.error) }, 422);
  }

  if (!OPENROUTER_API_KEY) {
    const ref = logServerError("Generation requested without OPENROUTER_API_KEY configured", new Error("missing key"));
    return json({ error: `Generation is temporarily unavailable. Support reference: ${ref}` }, 503);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Service unavailable" }, 503);
  }

  try {
    const { generationId, candidates } = await generateFlashcards(
      supabase,
      user.id,
      result.data.source_text,
      OPENROUTER_API_KEY,
    );
    return json({ generation_id: generationId, cards: candidates }, 201);
  } catch (error) {
    if (error instanceof OpenRouterAuthError) {
      const ref = logServerError("OpenRouter authentication failed", error);
      return json({ error: `Generation is temporarily unavailable. Support reference: ${ref}` }, 503);
    }
    if (error instanceof OpenRouterRateLimitError || error instanceof OpenRouterNetworkError) {
      return json({ error: "Generation timed out. Please try again." }, 504);
    }
    if (error instanceof GenerationValidationError || error instanceof OpenRouterProtocolError) {
      return json({ error: "The AI response could not be used. Please try again." }, 502);
    }
    const ref = logServerError("Unexpected error during flashcard generation", error);
    return json({ error: `Could not generate flashcards. Support reference: ${ref}` }, 500);
  }
};
