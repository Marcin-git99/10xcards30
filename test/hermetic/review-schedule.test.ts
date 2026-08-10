import { describe, expect, it } from "vitest";
import { isDueForReview, scheduleNextReview } from "@/lib/services/review-schedule";

/**
 * Ryzyko #6 z `context/foundation/test-plan.md` §2: „Karta wraca do powtórki
 * w złym terminie — ocena nie przesuwa jej zgodnie z drabiną interwałów".
 *
 * §Risk Response Guidance dla tego ryzyka stawia twardy warunek na kształt
 * testu: **„wyrocznia musi pochodzić z FR-021, nie z implementacji"**, a jako
 * antywzorzec wymienia „lustro implementacji" oraz „pominięcie granic (górne
 * ograniczenie, reset po negatywnej ocenie, karta niekompletna)".
 *
 * Dlatego interwały poniżej są PRZEPISANE Z PRD ręcznie, a nie zaimportowane
 * ze stałej `LADDER_DAYS`. Test importujący tę stałą przechodziłby również po
 * podmianie drabiny na dowolne inne liczby — czyli nie broniłby niczego.
 *
 * Cytat źródłowy (prd.md, FR-021):
 *   „The Leitner ladder uses these intervals: box 1 = 1 day, box 2 = 3 days,
 *    box 3 = 7 days, box 4 = 14 days, box 5 = 30 days."
 */

/** Moment oceny — wstrzykiwany, żeby wynik nie zależał od zegara maszyny. */
const NOW = new Date("2026-08-10T12:00:00.000Z");

/** Interwały przepisane z FR-021, wraz z datą, którą dają licząc od NOW. */
const FR_021_LADDER = [
  { box: 1, days: 1, dueAt: "2026-08-11T12:00:00.000Z" },
  { box: 2, days: 3, dueAt: "2026-08-13T12:00:00.000Z" },
  { box: 3, days: 7, dueAt: "2026-08-17T12:00:00.000Z" },
  { box: 4, days: 14, dueAt: "2026-08-24T12:00:00.000Z" },
  { box: 5, days: 30, dueAt: "2026-09-09T12:00:00.000Z" },
];

describe("scheduleNextReview — FR-018 [Wiem]", () => {
  /**
   * FR-018: „advances the current card up one box in the Leitner ladder
   * (capped at box 5) and re-schedules the card for the interval associated
   * with its NEW box."
   *
   * Ostatnie zdanie jest tu sednem: interwał bierze się z pudełka DOCELOWEGO,
   * nie wyjściowego. Implementacja czytająca interwał przed awansem
   * przesunęłaby każdą kartę o jeden szczebel za mało i nikt by tego nie
   * zauważył przez tygodnie.
   */
  it.each([
    { from: 1, expectedBox: 2, expectedDue: "2026-08-13T12:00:00.000Z" },
    { from: 2, expectedBox: 3, expectedDue: "2026-08-17T12:00:00.000Z" },
    { from: 3, expectedBox: 4, expectedDue: "2026-08-24T12:00:00.000Z" },
    { from: 4, expectedBox: 5, expectedDue: "2026-09-09T12:00:00.000Z" },
  ])(
    "z pudełka $from awansuje do $expectedBox i planuje na interwał nowego pudełka",
    ({ from, expectedBox, expectedDue }) => {
      const result = scheduleNextReview(from, "known", NOW);

      expect(result.leitner_box).toBe(expectedBox);
      expect(result.next_review_at).toBe(expectedDue);
    },
  );

  it("nie wypycha karty ponad pudełko 5 (górne ograniczenie z FR-018)", () => {
    const result = scheduleNextReview(5, "known", NOW);

    // Granica wprost wymieniona w §Risk Response Guidance jako ta, której
    // testy tego ryzyka zwykle nie pokrywają.
    expect(result.leitner_box).toBe(5);
    expect(result.next_review_at).toBe("2026-09-09T12:00:00.000Z");
  });
});

describe("scheduleNextReview — FR-019 [Nie wiem]", () => {
  /**
   * FR-019: „resets the current card to box 1 and re-schedules the card for
   * one day later." Bez względu na to, jak wysoko karta zaszła.
   */
  it.each([1, 2, 3, 4, 5])("z pudełka %i resetuje do 1 i planuje na jutro", (from) => {
    const result = scheduleNextReview(from, "unknown", NOW);

    expect(result.leitner_box).toBe(1);
    expect(result.next_review_at).toBe("2026-08-11T12:00:00.000Z");
  });
});

describe("scheduleNextReview — zgodność z drabiną FR-021", () => {
  it.each(FR_021_LADDER)("pudełko $box odpowiada interwałowi $days dni", ({ box, days, dueAt }) => {
    // Dojście do danego pudełka od dołu: awans z box-1, a dla pudełka 1 reset.
    const result = box === 1 ? scheduleNextReview(3, "unknown", NOW) : scheduleNextReview(box - 1, "known", NOW);

    expect(result.leitner_box).toBe(box);
    expect(result.next_review_at).toBe(dueAt);

    // Kontrola liczbowa niezależna od arytmetyki dat w implementacji.
    const elapsedDays = (new Date(result.next_review_at).getTime() - NOW.getTime()) / (24 * 60 * 60 * 1000);
    expect(elapsedDays).toBe(days);
  });
});

describe("scheduleNextReview — wejście spoza drabiny", () => {
  /**
   * Kolumna `cards.leitner_box` ma CHECK `between 1 and 5`, więc wartość spoza
   * zakresu oznacza uszkodzone dane albo błąd wywołującego. Ciche przycięcie
   * zamieniłoby jedno i drugie w prawidłowo wyglądający termin.
   */
  it.each([0, 6, -1, 1.5, Number.NaN])("odrzuca leitner_box = %s", (box) => {
    expect(() => scheduleNextReview(box, "known", NOW)).toThrow(RangeError);
  });
});

describe("isDueForReview", () => {
  const COMPLETE = { question: "Pytanie", answer: "Odpowiedź" };

  it("kwalifikuje kartę, której termin już minął (FR-015)", () => {
    expect(isDueForReview({ ...COMPLETE, next_review_at: "2026-08-10T11:59:59.000Z" }, NOW)).toBe(true);
  });

  it("kwalifikuje kartę, której termin wypada dokładnie teraz", () => {
    // Granica domknięta: FR-015 mówi „whose next-review time HAS ARRIVED".
    expect(isDueForReview({ ...COMPLETE, next_review_at: NOW.toISOString() }, NOW)).toBe(true);
  });

  it("nie kwalifikuje karty zaplanowanej na przyszłość", () => {
    expect(isDueForReview({ ...COMPLETE, next_review_at: "2026-08-11T12:00:00.000Z" }, NOW)).toBe(false);
  });

  it.each([
    { label: "pustym pytaniem", question: "", answer: "Odpowiedź" },
    { label: "pustą odpowiedzią", question: "Pytanie", answer: "" },
    { label: "samymi spacjami", question: "   ", answer: "   " },
  ])("wyklucza kartę z $label, choćby termin minął (FR-028)", ({ question, answer }) => {
    // Pustka jest pustym STRINGIEM, nie NULL-em — kolumny są NOT NULL, więc
    // baza tego nie odsieje. Wykluczenie musi żyć w regule kolejki.
    expect(isDueForReview({ question, answer, next_review_at: "2020-01-01T00:00:00.000Z" }, NOW)).toBe(false);
  });
});
