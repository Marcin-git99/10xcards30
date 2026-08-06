/**
 * Polityka błędów serwerowych: szczegóły idą do logu, do klienta wyłącznie
 * nieprzezroczysty identyfikator.
 *
 * Ryzyko #2 z `context/foundation/test-plan.md` wymaga, żeby odpowiedź API nie
 * niosła nazw tabel, kolumn, constraintów ani kodów błędów bazy. Ale redakcja
 * bez korelacji zamienia jeden problem na drugi: user widzi „coś poszło nie
 * tak", operator widzi log, i nie ma czym połączyć jednego z drugim. Precedens
 * §F5 w `context/archive/2026-06-09-db-schema-mvp/reviews/impl-review.md`
 * naprawiono w stronę redakcji — ta funkcja domyka drugą połowę.
 *
 * Identyfikator jest losowy i bezznaczeniowy z rozmysłem. Kod błędu bazy albo
 * nazwa constraintu byłyby wygodniejsze w logu, ale to dokładnie te wnętrzności,
 * których Ryzyko #2 zabrania wypuszczać.
 */
export function logServerError(context: string, detail: unknown): string {
  const ref = crypto.randomUUID();
  // Ref jako pierwszy element linii, żeby dało się go wyszukać w logach
  // Cloudflare bez znajomości reszty formatu.
  console.error(`[${ref}] ${context}`, detail);
  return ref;
}
