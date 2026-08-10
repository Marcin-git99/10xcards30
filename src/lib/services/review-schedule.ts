/**
 * Scheduler Leitner-light — jedyne miejsce, w którym powstaje harmonogram powtórek.
 *
 * PRD §Business Logic dzieli produkt na trzy rozłączne domeny: user kontroluje
 * treść fiszki, AI dostarcza surowca, a **algorytm kontroluje harmonogram**.
 * Ta funkcja jest całą trzecią domeną. Binarna ocena z sesji jest jedynym
 * wejściem — user nie ma żadnej innej drogi, żeby wpłynąć na terminy.
 *
 * Dlaczego funkcja czysta, bez dostępu do bazy: roadmap S-02 §Risk opisuje
 * awarię tego obszaru jako taką, która „cicho niszczy wartość produktu" — karta
 * wraca w złym terminie, nikt tego nie zauważa przez tygodnie. Reguła oderwana
 * od I/O daje się sprawdzić wyczerpująco, dla każdego pudełka i obu ocen, bez
 * stawiania bazy.
 */

/** Binarna samoocena z sesji powtórek (FR-017). */
export type Rating = "known" | "unknown";

export interface ReviewSchedule {
  /** Pozycja w drabinie po ocenie. Kolumna `cards.leitner_box`. */
  leitner_box: number;
  /** Termin następnej powtórki w ISO 8601. Kolumna `cards.next_review_at`. */
  next_review_at: string;
}

/**
 * FR-021: „box 1 = 1 day, box 2 = 3 days, box 3 = 7 days, box 4 = 14 days,
 * box 5 = 30 days". Indeks tablicy to `box - 1`.
 *
 * Te liczby są WYROCZNIĄ, nie szczegółem implementacyjnym — pochodzą z PRD
 * i test ma je cytować z PRD, nie odczytywać stąd. Test czytający tę stałą
 * byłby lustrem implementacji: przeszedłby także po podmianie drabiny na
 * dowolne inne wartości.
 */
const LADDER_DAYS = [1, 3, 7, 14, 30] as const;

const MIN_BOX = 1;
const MAX_BOX = LADDER_DAYS.length;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Wylicza pozycję w drabinie i termin następnej powtórki po ocenie karty.
 *
 * FR-018 ([Wiem]): awans o jedno pudełko, z ograniczeniem na pudełku 5,
 *   i przeplanowanie na interwał przypisany **nowemu** pudełku.
 * FR-019 ([Nie wiem]): reset do pudełka 1 i przeplanowanie na jutro.
 *
 * @param currentBox pozycja przed oceną (1–5, tak jak CHECK w schemacie)
 * @param rating     binarna samoocena użytkownika
 * @param now        moment oceny; wstrzykiwany, żeby test nie zależał od zegara
 *
 * @throws {RangeError} gdy `currentBox` jest poza drabiną
 */
export function scheduleNextReview(currentBox: number, rating: Rating, now: Date = new Date()): ReviewSchedule {
  // Świadomie rzucamy zamiast przycinać do zakresu. Kolumna ma CHECK
  // `between 1 and 5`, więc wartość spoza drabiny znaczy albo uszkodzone dane,
  // albo błąd w kodzie wywołującym. Ciche przycięcie zamieniłoby jedno i drugie
  // w prawidłowo wyglądający termin — czyli dokładnie w awarię, której ten
  // moduł ma nie popełniać.
  if (!Number.isInteger(currentBox) || currentBox < MIN_BOX || currentBox > MAX_BOX) {
    throw new RangeError(
      `leitner_box poza drabiną: ${String(currentBox)} (oczekiwano liczby całkowitej ${MIN_BOX}–${MAX_BOX})`,
    );
  }

  const nextBox = rating === "known" ? Math.min(currentBox + 1, MAX_BOX) : MIN_BOX;
  const days = LADDER_DAYS[nextBox - 1];

  return {
    leitner_box: nextBox,
    next_review_at: new Date(now.getTime() + days * MS_PER_DAY).toISOString(),
  };
}

/**
 * Czy karta kwalifikuje się do kolejki sesji powtórek.
 *
 * Dwa niezależne warunki, oba z PRD:
 *  - FR-015: termin powtórki już nadszedł;
 *  - §Business Logic / FR-028: karta z pustym pytaniem LUB pustą odpowiedzią
 *    (świeży draft manualny) jest z kolejki wykluczona, dopóki oba pola nie
 *    zostaną wypełnione.
 *
 * Drugi warunek jest łatwy do przeoczenia, bo w schemacie te kolumny są NOT NULL
 * — pustka jest pustym stringiem, nie NULL-em, więc baza jej nie odsieje.
 */
export function isDueForReview(
  card: { question: string; answer: string; next_review_at: string },
  now: Date = new Date(),
): boolean {
  if (!card.question.trim() || !card.answer.trim()) {
    return false;
  }

  return new Date(card.next_review_at).getTime() <= now.getTime();
}
