import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { logServerError } from "@/lib/api-error";
import { CARD_FIELD_MAX_LENGTH, EXPECTED_CARD_COUNT } from "@/lib/services/generation";
import type { Generation } from "@/types";

export const prerender = false;

const generationIdSchema = z.uuid();

const approveRequestSchema = z.object({
  cards: z
    .array(
      z.object({
        question: z.string().trim().min(1, "Question cannot be empty").max(CARD_FIELD_MAX_LENGTH),
        answer: z.string().trim().min(1, "Answer cannot be empty").max(CARD_FIELD_MAX_LENGTH),
      }),
    )
    .min(1)
    .max(EXPECTED_CARD_COUNT),
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

  const generationId = generationIdSchema.safeParse(context.params.id);
  if (!generationId.success) {
    return json({ error: "Invalid generation id" }, 400);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const result = approveRequestSchema.safeParse(body);
  if (!result.success) {
    return json({ error: z.flattenError(result.error) }, 422);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Service unavailable" }, 503);
  }

  // RLS scopes this to the caller's own rows already — a foreign generation_id
  // reads back as zero rows, same "denial looks like absence" shape as
  // cards/[id].ts, so null → 404 without a separate ownership check.
  const { data: generation, error: lookupError } = await supabase
    .from("generations")
    .select("id")
    .eq("id", generationId.data)
    .maybeSingle<Pick<Generation, "id">>();

  if (lookupError) {
    const ref = logServerError(`Failed to look up generation ${generationId.data}`, lookupError);
    return json({ error: `Could not approve the cards. Support reference: ${ref}` }, 500);
  }

  if (!generation) {
    return json({ error: "Generation not found" }, 404);
  }

  const { data: insertedCards, error: insertError } = await supabase
    .from("cards")
    .insert(
      result.data.cards.map((card) => ({
        question: card.question,
        answer: card.answer,
        user_id: user.id,
        source: "ai" as const,
        generation_id: generationId.data,
      })),
    )
    .select();

  if (insertError) {
    const ref = logServerError(`Failed to persist approved cards for generation ${generationId.data}`, insertError);
    return json({ error: `Could not approve the cards. Support reference: ${ref}` }, 500);
  }

  return json({ cards: insertedCards }, 201);
};
