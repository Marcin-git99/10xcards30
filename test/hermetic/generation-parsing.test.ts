import { describe, expect, it } from "vitest";
import { CARD_FIELD_MAX_LENGTH, GenerationValidationError, parseFlashcardCandidates } from "@/lib/services/generation";

/**
 * FR-008: "the system request from the external LLM exactly 5 question/answer
 * pairs". FR-027/US-09: "does not contain exactly five well-formed
 * question/answer pairs" jest warunkiem awarii obok przekroczenia 30s.
 *
 * Wyrocznia dla liczby 5 pochodzi z tych dwóch zdań PRD, nie z `EXPECTED_CARD_COUNT`
 * — import stałej byłby lustrem implementacji, tak jak w review-schedule.test.ts.
 */
const REQUIRED_PAIR_COUNT = 5;

function validPair(index: number): { question: string; answer: string } {
  return { question: `Pytanie ${index.toString()}?`, answer: `Odpowiedź ${index.toString()}.` };
}

function fiveValidPairs(): { question: string; answer: string }[] {
  return Array.from({ length: REQUIRED_PAIR_COUNT }, (_, i) => validPair(i + 1));
}

function flashcardsJson(pairs: unknown[]): string {
  return JSON.stringify({ flashcards: pairs });
}

describe("parseFlashcardCandidates — ścieżka pozytywna", () => {
  it("przepuszcza bezpośredni JSON z dokładnie 5 parami", () => {
    const result = parseFlashcardCandidates(flashcardsJson(fiveValidPairs()));

    expect(result).toHaveLength(REQUIRED_PAIR_COUNT);
    expect(result[0]).toEqual({ question: "Pytanie 1?", answer: "Odpowiedź 1." });
  });

  it("odzyskuje 5 par z JSON-a owiniętego w prozę modelu (ścieżka fallback)", () => {
    // response_format ma to wymusić, ale to siatka bezpieczeństwa na wypadek
    // modelu, który dokleja komentarz przed/po bloku JSON.
    const wrapped = `Oto wygenerowane fiszki:\n\`\`\`json\n${flashcardsJson(fiveValidPairs())}\n\`\`\`\nMam nadzieję, że się przydadzą.`;

    const result = parseFlashcardCandidates(wrapped);

    expect(result).toHaveLength(REQUIRED_PAIR_COUNT);
  });
});

describe("parseFlashcardCandidates — liczba par musi być DOKŁADNIE 5", () => {
  it("odrzuca 4 poprawne pary (za mało)", () => {
    const pairs = Array.from({ length: 4 }, (_, i) => validPair(i + 1));

    expect(() => parseFlashcardCandidates(flashcardsJson(pairs))).toThrow(GenerationValidationError);
  });

  it("odrzuca 6 poprawnych par (za dużo)", () => {
    const pairs = Array.from({ length: 6 }, (_, i) => validPair(i + 1));

    expect(() => parseFlashcardCandidates(flashcardsJson(pairs))).toThrow(GenerationValidationError);
  });

  it("para z pustą (po trim) odpowiedzią jest wykluczona i zbija liczbę poniżej 5", () => {
    const pairs = [...fiveValidPairs().slice(0, 4), { question: "Pytanie 5?", answer: "   " }];

    expect(() => parseFlashcardCandidates(flashcardsJson(pairs))).toThrow(GenerationValidationError);
  });

  it("kompletnie nieparsowalny tekst rzuca, zamiast zwrócić pustą listę", () => {
    expect(() => parseFlashcardCandidates("to nie jest ani JSON, ani nic, co go przypomina")).toThrow(
      GenerationValidationError,
    );
  });
});

describe("parseFlashcardCandidates — twarde obcinanie pól, nie odrzucanie", () => {
  it("pole dłuższe niż limit jest przycinane, para zostaje zaliczona", () => {
    const overlong = "x".repeat(CARD_FIELD_MAX_LENGTH + 50);
    const pairs = [...fiveValidPairs().slice(0, 4), { question: overlong, answer: "Odpowiedź 5." }];

    const result = parseFlashcardCandidates(flashcardsJson(pairs));

    expect(result).toHaveLength(REQUIRED_PAIR_COUNT);
    const clamped = result.find((c) => c.answer === "Odpowiedź 5.");
    expect(clamped?.question).toHaveLength(CARD_FIELD_MAX_LENGTH);
  });
});
