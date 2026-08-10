import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { logServerError } from "@/lib/api-error";
import type { Card } from "@/types";

export const prerender = false;

/**
 * Mutacje pojedynczej karty: edycja treści (FR-025) i usunięcie (FR-025).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DLACZEGO 404, A NIE 200, GDY NIC SIĘ NIE ZMIENIŁO
 *
 * Odmowa RLS jest CICHA. PostgREST na `UPDATE`/`DELETE` cudzego wiersza zwraca
 * HTTP 200, `error: null` i zero wierszy — nie 403 i nie wyjątek (zmierzone
 * podczas researchu do `testing-data-isolation`, potwierdzone testem
 * `test/integration/cards-isolation.test.ts`). Baza nie krzyczy, tylko nic nie
 * robi.
 *
 * Endpoint, który nie sprawdzi liczby trafionych wierszy, odpowie więc `200 OK`
 * na próbę skasowania cudzej karty. Bezpieczeństwo zadziała — rekord ocaleje —
 * ale API skłamie użytkownikowi, że operacja się udała, a UI skasuje kartę
 * z listy. Dlatego brak wiersza to 404.
 *
 * 404 dla obu przypadków — „nie ma takiej karty" i „jest, ale cudza" — jest
 * decyzją świadomą: identyczna odpowiedź nie pozwala sondować, które
 * identyfikatory istnieją w cudzych bibliotekach.
 *
 * `maybeSingle()`, nie `single()`: to drugie zamienia zero wierszy w błąd
 * PGRST116, więc „nie znaleziono" wpadłoby do gałęzi 500 razem z realnymi
 * awariami bazy i zniknęło z widoku jako osobny przypadek.
 * ────────────────────────────────────────────────────────────────────────────
 */

const cardIdSchema = z.uuid();

/**
 * FR-026: edycja z „Moje fiszki" zmienia WYŁĄCZNIE pytanie i/lub odpowiedź;
 * pozycja w drabinie Leitnera i termin następnej powtórki pozostają nietknięte.
 *
 * Egzekwuje to sam kształt schematu, nie dyscyplina piszącego: `z.object` bez
 * `.strict()` usuwa nieznane pola, więc do `update()` trafia dokładnie to, co
 * przeszło walidację. Żądanie z `leitner_box` albo `next_review_at` nie tyle
 * zostanie odrzucone, ile te pola nigdy nie dojdą do zapytania — a że po
 * usunięciu zostaje pusty obiekt, `refine` zwróci 422 zamiast wykonać zapis
 * bez zmian. To samo dotyczy `user_id`: RLS ma `with check`, ale aplikacja nie
 * daje nawet szansy spróbować.
 */
const updateCardSchema = z
  .object({
    question: z.string().trim().min(1, "Question cannot be empty").max(500),
    answer: z.string().trim().min(1, "Answer cannot be empty").max(500),
  })
  .partial()
  .refine((patch) => patch.question !== undefined || patch.answer !== undefined, {
    message: "Provide question, answer, or both",
  });

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Bramka wspólna dla obu metod: sesja, poprawność identyfikatora, dostępność
 * Supabase. Zwraca albo gotową odpowiedź błędu, albo materiał do zapytania.
 *
 * Bramka API jest tu ŚWIADOMIE zdublowana wobec `PROTECTED_ROUTES`
 * w `src/middleware.ts`. To dwie różne bramki — antywzorzec „middleware chroni
 * stronę, więc API też jest chronione" jest wprost wymieniony w §Risk Response
 * Guidance dla Ryzyka 3, a `/api/` nie figuruje na liście tras chronionych.
 */
type Gate =
  | { ok: false; response: Response }
  | { ok: true; cardId: string; supabase: NonNullable<ReturnType<typeof createClient>> };

function openGate(context: Parameters<APIRoute>[0]): Gate {
  const user = context.locals.user;
  if (!user) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }

  const cardId = cardIdSchema.safeParse(context.params.id);
  if (!cardId.success) {
    // 400, nie 404: identyfikator nie jest nawet w kształcie, w którym mógłby
    // istnieć, więc nie ma czego szukać ani czego ukrywać.
    return { ok: false, response: json({ error: "Invalid card id" }, 400) };
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return { ok: false, response: json({ error: "Service unavailable" }, 503) };
  }

  return { ok: true, cardId: cardId.data, supabase };
}

export const PUT: APIRoute = async (context) => {
  const gate = openGate(context);
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const result = updateCardSchema.safeParse(body);
  if (!result.success) {
    return json({ error: z.flattenError(result.error) }, 422);
  }

  const { data, error } = await gate.supabase
    .from("cards")
    .update(result.data)
    .eq("id", gate.cardId)
    .select()
    .maybeSingle<Card>();

  if (error) {
    const ref = logServerError(`Failed to update card ${gate.cardId}`, error);
    return json({ error: `Could not update the card. Support reference: ${ref}` }, 500);
  }

  if (!data) {
    return json({ error: "Card not found" }, 404);
  }

  return json(data, 200);
};

export const DELETE: APIRoute = async (context) => {
  const gate = openGate(context);
  if (!gate.ok) return gate.response;

  const { data, error } = await gate.supabase.from("cards").delete().eq("id", gate.cardId).select().maybeSingle<Card>();

  if (error) {
    const ref = logServerError(`Failed to delete card ${gate.cardId}`, error);
    return json({ error: `Could not delete the card. Support reference: ${ref}` }, 500);
  }

  if (!data) {
    return json({ error: "Card not found" }, 404);
  }

  // Zwracamy tożsamość skasowanego wiersza, a nie 204: klient potwierdza, że
  // zniknęło dokładnie to, co zamierzał, zamiast ufać, że trafił we właściwy
  // element listy.
  return json({ id: data.id }, 200);
};
