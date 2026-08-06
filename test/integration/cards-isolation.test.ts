import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAnonymousClient, createIdentity, type Identity } from "../helpers/identities";
import type { Card } from "@/types";

/**
 * Ryzyko #4 z test-plan.md §2: „Dane jednego usera są widoczne lub
 * modyfikowalne przez innego usera".
 *
 * Wyrocznia pochodzi z PRD, nie z implementacji:
 *   - Guardrail 3 (prd.md:59): „Żadne dane (fiszki, historia generacji,
 *     profil) jednego usera nie są widoczne ani działalne przez innego usera."
 *   - NFR (prd.md:211): to samo jako wymaganie niefunkcjonalne.
 *
 * KLUCZOWE dla kształtu asercji: odmowa RLS jest CICHA. PostgREST zwraca
 * HTTP 200, `error: null` i zero wierszy — nie 403 i nie wyjątek (zmierzone,
 * research.md §A). Test napisany jako „oczekuj błędu" przeszedłby także na
 * bazie z wyłączonym RLS, gdyby danych po prostu nie było. Dlatego asercje
 * idą na STAN PO OPERACJI, nie na kod odpowiedzi.
 *
 * Egzekwowanie własności zasobu leży dziś w całości w bazie — `dashboard.astro`
 * czyta karty bez filtra po `user_id`. Dlatego testy uderzają wprost w bazę,
 * bez bootowania Astro: mockowanie tej warstwy byłoby antywzorcem wprost
 * wymienionym w §Risk Response Guidance.
 */
describe("izolacja kart między userami", () => {
  let alice: Identity;
  let bob: Identity;
  let aliceCardId: string;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([createIdentity("alice"), createIdentity("bob")]);
  });

  // Świeża karta przed każdym testem — dzięki temu test usuwania nie psuje
  // testu modyfikacji i kolejność w pliku przestaje mieć znaczenie.
  beforeEach(async () => {
    const { data, error } = await alice.client
      .from("cards")
      .insert({ question: "Pytanie Alice", answer: "Odpowiedź Alice", user_id: alice.userId })
      .select()
      .single<Card>();

    expect(error).toBeNull();
    if (!data) throw new Error("nie udało się utworzyć karty Alice");
    aliceCardId = data.id;
  });

  /** Odczyt karty Alice jej własnym klientem — dowód stanu po operacji Boba. */
  async function readAsAlice(): Promise<Card | null> {
    const { data } = await alice.client.from("cards").select().eq("id", aliceCardId).maybeSingle<Card>();
    return data;
  }

  it("nie pokazuje userowi B żadnej karty usera A", async () => {
    const { data, error } = await bob.client.from("cards").select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("nie wydaje karty usera A, gdy user B poda jej identyfikator", async () => {
    const { data, error } = await bob.client.from("cards").select().eq("id", aliceCardId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("nie zmienia treści karty usera A, gdy user B próbuje ją nadpisać", async () => {
    await bob.client.from("cards").update({ question: "PWNED" }).eq("id", aliceCardId);

    // Dowód idzie przez klienta Alice. Pusty wynik `update()` Boba nie jest
    // dowodem: bez `.select()` PostgREST nie zwraca wierszy nawet przy
    // udanym zapisie, więc asercja na jego wyniku byłaby zielona także wtedy,
    // gdyby Bob faktycznie nadpisał kartę.
    const row = await readAsAlice();

    expect(row?.question).toBe("Pytanie Alice");
  });

  it("nie usuwa karty usera A, gdy user B próbuje ją skasować", async () => {
    await bob.client.from("cards").delete().eq("id", aliceCardId);

    // Odczyt znów przez Alice: pusty wynik Boba nie odróżniłby „RLS
    // zablokowało odczyt" od „karta została skasowana".
    const row = await readAsAlice();

    expect(row).not.toBeNull();
    expect(row?.id).toBe(aliceCardId);
  });

  it("nie pokazuje żadnych kart klientowi bez sesji", async () => {
    const { data, error } = await createAnonymousClient().from("cards").select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("odrzuca zapis karty z cudzym user_id", async () => {
    // Jedyny scenariusz dający TWARDY błąd. Broni rozjazdu między dwoma
    // niezależnymi źródłami tożsamości: `user_id` zapisywany do bazy pochodzi
    // z `context.locals.user` (middleware), a RLS sprawdza `auth.uid()`
    // z ciasteczka. Gdyby się rozjechały, jedyną obroną jest
    // `WITH CHECK (user_id = auth.uid())` — nic w kodzie aplikacji tego nie
    // dubluje.
    const { error } = await alice.client
      .from("cards")
      .insert({ question: "podszywka", answer: "podszywka", user_id: bob.userId })
      .select();

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });
});
