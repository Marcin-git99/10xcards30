import { test, expect } from "@playwright/test";
import { authenticatedClient, readTestUser } from "./helpers/test-user";

/**
 * Chronione ryzyko: **Ryzyko 3** z `context/foundation/test-plan.md` —
 * „osoba bez ważnej sesji dosięga chronionego ekranu albo danych".
 *
 * Wzorzec: `e2e/seed.spec.ts` (lokatory po rolach, czekanie na stan,
 * unikalne dane, cleanup przez klienta właściciela).
 *
 * Dowód ochrony wg §Risk Response Guidance: żądanie bez ważnej sesji
 * **nie otrzymuje treści chronionej**. Świadomie NIE asercjonujemy na kod
 * odpowiedzi — §Risk Response Guidance wskazuje „asercja na kod odpowiedzi
 * zamiast na stan końcowy" jako antywzorzec dla tej rodziny ryzyk.
 *
 * Dlaczego to zasługuje na przeglądarkę, a nie na test integracyjny:
 * sesja Supabase żyje w ciasteczku pociętym na fragmenty, które składa
 * dopiero klient. `test-plan.md` §6.6 notuje realny incydent z tej klasy —
 * „zalogowany na `/`, odbity z `/dashboard`" przy pomieszanych fragmentach.
 * Bramka strony i składanie ciasteczek są tu jedną, nierozdzielną ścieżką.
 *
 * Realne granice: przeglądarka → ciasteczka → middleware → routing → SSR →
 * Postgres z RLS. Nic nie jest mockowane.
 *
 * ZAKRES: ten test pokrywa bramkę **strony**. Druga połowa Ryzyka 3 —
 * „middleware chroni stronę, więc API też jest chronione" to dwie różne
 * bramki — dotyczy kontraktu endpointu i należy do warstwy integracyjnej,
 * nie do E2E.
 */

const uniqueQuestion = () => `E2E gate ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test("signed-out visitor is bounced from /library and sees none of the owner's cards (Risk 3)", async ({
  page,
  browser,
  baseURL,
}) => {
  const question = uniqueQuestion();
  const answer = "Treść, która nie ma prawa wyciec";

  // ── Setup: właściciel ma fiszkę ────────────────────────────────────────
  // Bez tego kroku test jest pusty w sensie dowodowym: „anonim nie widzi
  // fiszki" przechodzi trywialnie, gdy żadnej fiszki nie ma. Żeby dowieść,
  // że bramka chroni TREŚĆ, treść musi istnieć.
  //
  // Zakładamy ją przez API, nie przez formularz — ta sama zasada co przy
  // logowaniu: setup, który nie jest przedmiotem testu, nie idzie przez UI.
  // Ścieżkę zapisu przez formularz udowadnia `seed.spec.ts`; powtarzanie jej
  // tutaj kosztowało ~10 s (hydratacja + POST + render) i wypychało test poza
  // limit czasu, nie dokładając ani jednej asercji o bramce dostępu.
  // `user_id` jawnie — kolumna nie ma wartości domyślnej, a polityka INSERT
  // wymaga `user_id = auth.uid()` (tak samo robi `src/pages/api/cards.ts`).
  const testUser = readTestUser();
  const owner = await authenticatedClient(testUser);
  const { error: seedError } = await owner.from("cards").insert({ question, answer, user_id: testUser.userId });
  expect(seedError?.message, "setup: nie udało się założyć fiszki właściciela").toBeUndefined();

  // Właściciel faktycznie widzi swoją fiszkę na chronionym ekranie. To jest
  // też druga połowa Ryzyka 3 („zalogowany user jest odbijany od własnych
  // ekranów") — gdyby middleware odbijał zbyt gorliwie, padnie tutaj.
  await page.goto("/library");
  await expect(page.getByRole("listitem").filter({ hasText: question })).toBeVisible();

  // ── Akcja: ten sam adres, przeglądarka bez sesji ───────────────────────
  // Świeży kontekst z pustym storageState. `browser.newContext()` nie
  // dziedziczy opcji z `use`, więc baseURL podajemy jawnie.
  const anonContext = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  const anonPage = await anonContext.newPage();

  try {
    await anonPage.goto("/library");

    // ── Asercja ryzyka ───────────────────────────────────────────────────
    // 1. Anonim ląduje na logowaniu, a nie na chronionym ekranie.
    await expect(anonPage).toHaveURL(/\/auth\/signin/);

    // 2. Strona logowania naprawdę się wyrenderowała. Bez tego asercja (3)
    //    byłaby próżna — `toHaveCount(0)` przechodzi także dla pustej strony
    //    błędu, więc sama w sobie nie odróżnia „bramka zadziałała" od
    //    „aplikacja się wywaliła".
    await expect(anonPage.getByRole("heading", { name: "Sign in" })).toBeVisible();

    // 3. Treść właściciela nie wyciekła do dokumentu. Sprawdzamy zarówno
    //    pytanie, jak i odpowiedź — wyciek połowiczny to nadal wyciek.
    await expect(anonPage.getByText(question)).toHaveCount(0);
    await expect(anonPage.getByText(answer)).toHaveCount(0);
  } finally {
    await anonContext.close();
  }
});

/** Cleanup przez klienta zalogowanego na to samo konto — RLS wymaga właściciela. */
test.afterEach(async () => {
  const client = await authenticatedClient(readTestUser());
  await client.from("cards").delete().like("question", "E2E gate %");
});
