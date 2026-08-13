import { z } from "zod";
import { requestChatCompletion } from "@/lib/openrouter";
import type { createClient } from "@/lib/supabase";
import type { Generation } from "@/types";

/**
 * Generacja fiszek przez AI (S-01). Rozdział na dwie odpowiedzialności:
 * `parseFlashcardCandidates` jest CZYSTA (żadnego I/O) i testowalna jak
 * `review-schedule.ts` — bez mocków, wyrocznie prosto z FR-008/FR-027.
 * `generateFlashcards` jest orkiestracją (sieć + baza) i testowana przez
 * mockowanie granic (`@/lib/openrouter`, `@/lib/supabase`), tak jak route'y
 * `api/cards.ts` są testowane dziś.
 */

export const EXPECTED_CARD_COUNT = 5;
export const SOURCE_TEXT_MIN_LENGTH = 500;
export const SOURCE_TEXT_MAX_LENGTH = 5000;
export const CARD_FIELD_MAX_LENGTH = 500;

export interface FlashcardCandidate {
  question: string;
  answer: string;
}

export class GenerationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationValidationError";
  }
}

/** SHA-256 zamiast MD5 referencyjnego projektu — `node:crypto` nie jest bezpiecznym
 * wyborem na workerd; Web Crypto jest natywne dla Cloudflare Workers. */
export async function hashSourceText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const FLASHCARD_SYSTEM_PROMPT = `Jesteś ekspertem w tworzeniu fiszek edukacyjnych. Twoim zadaniem jest przeanalizowanie dostarczonego tekstu i wygenerowanie zestawu fiszek do nauki.

Zasady tworzenia fiszek:
1. Każda fiszka zawiera jedno konkretne pytanie i zwięzłą odpowiedź.
2. Pytania są jasne i jednoznaczne.
3. Odpowiedzi są zwięzłe, ale kompletne.
4. Skup się na najważniejszych pojęciach, faktach, datach i zależnościach.
5. Unikaj pytań zbyt ogólnych lub trywialnych.
6. Pytanie: maksymalnie 200 znaków. Odpowiedź: maksymalnie 500 znaków.

Wygeneruj DOKŁADNIE 5 fiszek. Fiszki muszą być w tym samym języku co tekst źródłowy.`;

function buildUserMessage(sourceText: string): string {
  return `Przeanalizuj poniższy tekst i wygeneruj fiszki edukacyjne w tym samym języku:\n\n${sourceText}`;
}

const FLASHCARDS_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    flashcards: {
      type: "array",
      minItems: EXPECTED_CARD_COUNT,
      maxItems: EXPECTED_CARD_COUNT,
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
        required: ["question", "answer"],
        additionalProperties: false,
      },
    },
  },
  required: ["flashcards"],
  additionalProperties: false,
};

const candidateItemSchema = z.object({
  question: z.string(),
  answer: z.string(),
});

/**
 * Wycina podciąg między pierwszym `openChar` a ostatnim `closeChar`. Zamiast
 * regexu z referencyjnego projektu (ryzyko patologicznego backtrackingu na
 * długim wejściu) — indeksowanie jest O(n) i bez niespodzianek na zagnieżdżonych
 * nawiasach klamrowych wewnątrz listy fiszek.
 */
function extractJsonSlice(content: string, openChar: string, closeChar: string): string | null {
  const start = content.indexOf(openChar);
  const end = content.lastIndexOf(closeChar);
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return content.slice(start, end + 1);
}

function tryParseJson(candidate: string | null): unknown {
  if (candidate === null) {
    return undefined;
  }
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

/**
 * `response_format` powinien wymusić poprawny JSON, ale modele bywają
 * niesforne — to jest siatka bezpieczeństwa, nie ścieżka główna.
 */
function parseRawJson(rawContent: string): unknown {
  const direct = tryParseJson(rawContent);
  if (direct !== undefined) {
    return direct;
  }

  if (rawContent.includes('"flashcards"')) {
    const objectSlice = tryParseJson(extractJsonSlice(rawContent, "{", "}"));
    if (objectSlice !== undefined) {
      return objectSlice;
    }
  }

  const arraySlice = tryParseJson(extractJsonSlice(rawContent, "[", "]"));
  if (arraySlice !== undefined) {
    return arraySlice;
  }

  throw new GenerationValidationError("Nie udało się sparsować odpowiedzi AI jako JSON.");
}

function normalizeToArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (typeof parsed === "object" && parsed !== null && "flashcards" in parsed) {
    if (Array.isArray(parsed.flashcards)) {
      return parsed.flashcards;
    }
  }
  return [];
}

/**
 * Czysta — bez I/O. DOKŁADNIE 5 poprawnych par albo throw: FR-027/US-09
 * definiują "nie zawiera dokładnie pięciu dobrze sformowanych par" jako
 * warunek awarii, więc dopełnianie/przycinanie listy zamiast rzucania
 * ukrywałoby dokładnie ten stan, który ma być pokazany userowi.
 */
export function parseFlashcardCandidates(rawContent: string): FlashcardCandidate[] {
  const parsed = parseRawJson(rawContent);
  const rawItems = normalizeToArray(parsed);

  const candidates: FlashcardCandidate[] = [];
  for (const item of rawItems) {
    const result = candidateItemSchema.safeParse(item);
    if (!result.success) {
      continue;
    }
    const question = result.data.question.trim().slice(0, CARD_FIELD_MAX_LENGTH);
    const answer = result.data.answer.trim().slice(0, CARD_FIELD_MAX_LENGTH);
    if (!question || !answer) {
      continue;
    }
    candidates.push({ question, answer });
  }

  if (candidates.length !== EXPECTED_CARD_COUNT) {
    throw new GenerationValidationError(
      `Odpowiedź AI zawierała ${String(candidates.length)} poprawnych fiszek zamiast dokładnie ${String(EXPECTED_CARD_COUNT)}.`,
    );
  }

  return candidates;
}

/**
 * Orkiestracja: hash → wywołanie OpenRouter → parsowanie → zapis wiersza
 * `generations`. Wiersz `generations` powstaje TYLKO po sukcesie — nieudana
 * próba nie zostawia śladu poza błędem widocznym userowi (patrz plan.md,
 * "Critical Implementation Details").
 */
export async function generateFlashcards(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  userId: string,
  sourceText: string,
  apiKey: string,
): Promise<{ generationId: string; candidates: FlashcardCandidate[] }> {
  const sourceTextHash = await hashSourceText(sourceText);

  const rawContent = await requestChatCompletion({
    apiKey,
    systemPrompt: FLASHCARD_SYSTEM_PROMPT,
    userMessage: buildUserMessage(sourceText),
    jsonSchema: FLASHCARDS_JSON_SCHEMA,
  });

  const candidates = parseFlashcardCandidates(rawContent);

  const { data, error } = await supabase
    .from("generations")
    .insert({ user_id: userId, source_text_hash: sourceTextHash, source_text_length: sourceText.length })
    .select()
    .single<Generation>();

  if (error) {
    throw error;
  }

  return { generationId: data.id, candidates };
}
