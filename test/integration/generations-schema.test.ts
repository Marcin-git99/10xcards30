import { describe, expect, it } from "vitest";
import { createIdentity } from "../helpers/identities";
import type { Generation } from "@/types";

/**
 * Ryzyko #2, twarz trzecia: wklejony przez usera tekst źródłowy zostaje
 * w miejscu dostępnym dla operatora.
 *
 * Wyrocznia jest jednoznaczna i pochodzi z dwóch niezależnych miejsc PRD:
 *   - Guardrail 2 (prd.md:58): „Wklejony przez usera tekst źródłowy nie
 *     pozostawia śladu w operator-accessible storage […]; system zachowuje
 *     wyłącznie nieodwracalny identyfikator i długość."
 *   - NFR (prd.md:208): to samo jako wymaganie niefunkcjonalne.
 *
 * Funkcja generacji jeszcze nie istnieje (slice S-01), więc zachowania nie ma
 * czego testować. Testowalna jest natomiast STRUKTURA: tabela, która nie ma
 * gdzie pomieścić tekstu źródłowego, nie może go zgubić. Regresja, przed którą
 * to chroni, jest realna i nieodwracalna po fakcie — ktoś dokłada kolumnę
 * `source_text` „na czas debugowania" i produkcja zaczyna przechowywać treści
 * userów.
 */

const ALLOWED_COLUMNS = ["created_at", "id", "source_text_hash", "source_text_length", "user_id"];

describe("schemat tabeli generations", () => {
  it("nie ma kolumny mogącej pomieścić tekst źródłowy", async () => {
    const alice = await createIdentity("schema");

    const { data, error } = await alice.client
      .from("generations")
      .insert({ user_id: alice.userId, source_text_hash: "hash", source_text_length: 4200 })
      .select()
      .single<Generation>();

    expect(error).toBeNull();
    if (!data) throw new Error("insert nie zwrócił wiersza");

    // Asercja na RÓWNOŚĆ zbioru, nie na obecność wybranych kolumn. Regresja
    // polega na DODANIU kolumny — sprawdzanie samej obecności `source_text_hash`
    // i `source_text_length` przepuściłoby nowe `source_text` bez mrugnięcia.
    expect(Object.keys(data).sort()).toEqual(ALLOWED_COLUMNS);
  });

  it("przechowuje długość tekstu, a nie sam tekst", async () => {
    const alice = await createIdentity("schema_len");
    const sourceText = "Bardzo długi tekst źródłowy wklejony przez użytkownika do generacji fiszek.";

    const { data, error } = await alice.client
      .from("generations")
      .insert({
        user_id: alice.userId,
        source_text_hash: "nieodwracalny-skrot",
        source_text_length: sourceText.length,
      })
      .select()
      .single<Generation>();

    expect(error).toBeNull();
    if (!data) throw new Error("insert nie zwrócił wiersza");

    // Kontrola pozytywna: to, co PRD pozwala zachować, faktycznie się zachowuje.
    // Bez niej test powyżej przechodziłby także wtedy, gdyby tabela była pusta
    // ze wszystkiego poza `id`.
    expect(JSON.stringify(data)).not.toContain(sourceText);
    expect(data.source_text_length).toBe(sourceText.length);
  });
});
