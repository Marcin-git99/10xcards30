import { beforeAll, describe, expect, it } from "vitest";
import { createIdentity, type Identity } from "../helpers/identities";
import type { Generation } from "@/types";

/**
 * Ryzyko #4 rozciągnięte na drugą tabelę z danymi usera. PRD Guardrail 3
 * (prd.md:59) wymienia trzy rzeczy: fiszki, **historię generacji** i profil —
 * test tylko na `cards` pokrywałby jedną trzecią reguły.
 *
 * `generations` ma świadomie tylko polityki INSERT i SELECT; brak UPDATE
 * i DELETE jest udokumentowany w migracji 20260609211146:30-33 (rekordy są
 * niezmienne, kasowanie idzie kaskadą z auth.users). Dlatego testujemy tylko
 * te dwie operacje — asercja na nieistniejącej polityce pinowałaby decyzję,
 * której nikt nie podjął.
 */
describe("izolacja historii generacji między userami", () => {
  let alice: Identity;
  let bob: Identity;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([createIdentity("gen_alice"), createIdentity("gen_bob")]);

    const { error } = await alice.client.from("generations").insert({
      user_id: alice.userId,
      source_text_hash: "hash-alice",
      source_text_length: 1234,
    });
    expect(error).toBeNull();
  });

  it("nie pokazuje userowi B historii generacji usera A", async () => {
    const { data, error } = await bob.client.from("generations").select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("pokazuje userowi A jego własną historię", async () => {
    // Kontrola pozytywna: bez niej test powyżej przechodziłby również wtedy,
    // gdyby zapis w beforeAll cicho się nie powiódł i tabela była pusta.
    const { data, error } = await alice.client
      .from("generations")
      .select()
      .overrideTypes<Generation[], { merge: false }>();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0].source_text_hash).toBe("hash-alice");
  });

  it("odrzuca zapis generacji z cudzym user_id", async () => {
    const { error } = await alice.client
      .from("generations")
      .insert({ user_id: bob.userId, source_text_hash: "podszywka", source_text_length: 1 })
      .select();

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });
});
