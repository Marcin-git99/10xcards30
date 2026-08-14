import { useEffect, useState } from "react";
import { Library, Plus, Sparkles, PencilLine, Pencil, Trash2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Card } from "@/types";

interface Props {
  initialCards: Card[];
  loadError?: boolean;
  generatedCount?: number;
}

/**
 * Kształt ciała błędu z `/api/cards/:id` — ten sam kontrakt co w
 * `CreateCardForm`: pole `error` bywa stringiem (400/401/404/500) albo obiektem
 * zoda (422). Bez rozróżnienia React dostaje obiekt jako child i wyspa pada.
 */
interface ApiErrorBody {
  error?: unknown;
}

function SourceBadge({ source }: { source: Card["source"] }) {
  const isAi = source === "ai";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        isAi ? "bg-blue-500/20 text-blue-200" : "bg-purple-500/20 text-purple-200",
      )}
    >
      {isAi ? <Sparkles className="size-3" /> : <PencilLine className="size-3" />}
      {isAi ? "AI" : "ręczna"}
    </span>
  );
}

const actionButton =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export default function LibraryView({ initialCards, loadError = false, generatedCount = 0 }: Props) {
  const [cards, setCards] = useState<Card[]>(initialCards);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ question: "", answer: "" });
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showGeneratedBanner, setShowGeneratedBanner] = useState(generatedCount > 0);

  // Strip `?generated=N` po zamontowaniu, żeby odświeżenie strony nie
  // pokazało banera ponownie — bez round-tripu do serwera.
  useEffect(() => {
    if (generatedCount > 0) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [generatedCount]);

  /**
   * Jedno miejsce na odczyt błędu, żeby każdy handler tak samo radził sobie
   * z 404. Ten kod NIE jest teoretyczny: endpoint zwraca 404 również wtedy, gdy
   * karta należy do kogoś innego — a to znaczy, że lista w przeglądarce może
   * być nieaktualna względem bazy (druga karta, druga sesja, inny komputer).
   */
  async function describeFailure(res: Response, fallback: string): Promise<string> {
    if (res.status === 404) {
      return "Ta fiszka już nie istnieje. Odśwież stronę.";
    }
    try {
      const body = (await res.json()) as ApiErrorBody;
      return typeof body.error === "string" ? body.error : fallback;
    } catch {
      return fallback;
    }
  }

  function startEdit(card: Card) {
    setError(null);
    setConfirmingId(null);
    setEditingId(card.id);
    setDraft({ question: card.question, answer: card.answer });
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  async function saveEdit(id: string) {
    const question = draft.question.trim();
    const answer = draft.answer.trim();

    // Walidacja po stronie klienta lustrzana do schematu endpointu — nie zastępuje
    // jej, tylko oszczędza round-trip. Autorytetem pozostaje serwer.
    if (!question || !answer) {
      setError("Pytanie i odpowiedź nie mogą być puste.");
      return;
    }

    setPendingId(id);
    setError(null);

    try {
      const res = await fetch(`/api/cards/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer }),
      });

      if (!res.ok) {
        setError(await describeFailure(res, "Nie udało się zapisać zmian."));
        return;
      }

      // Podmieniamy kartę odpowiedzią SERWERA, nie lokalnym draftem. Serwer
      // przycina białe znaki i odsyła `updated_at` — użycie draftu rozjechałoby
      // widok z bazą przy pierwszej rozbieżności.
      const updated = (await res.json()) as Card;
      setCards((prev) => prev.map((card) => (card.id === id ? updated : card)));
      setEditingId(null);
    } catch {
      setError("Brak połączenia z serwerem — spróbuj ponownie.");
    } finally {
      setPendingId(null);
    }
  }

  async function confirmDelete(id: string) {
    setPendingId(id);
    setError(null);

    try {
      const res = await fetch(`/api/cards/${id}`, { method: "DELETE" });

      if (!res.ok) {
        setError(await describeFailure(res, "Nie udało się usunąć fiszki."));
        return;
      }

      setCards((prev) => prev.filter((card) => card.id !== id));
      setConfirmingId(null);
    } catch {
      setError("Brak połączenia z serwerem — spróbuj ponownie.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="flex items-center gap-2 bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-2xl font-bold text-transparent">
          <Library className="size-6 text-blue-200" />
          Moje fiszki
          <span className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-sm font-normal text-blue-100/60">
            {cards.length}
          </span>
        </h1>

        <button
          type="button"
          disabled
          title="Dostępne wkrótce"
          className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="size-4" />
          Nowa fiszka
        </button>
      </div>

      {showGeneratedBanner && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border border-green-400/30 bg-green-500/10 p-4 text-sm text-green-200"
        >
          <span className="flex items-center gap-2">
            <Sparkles className="size-4" />
            {generatedCount} {generatedCount === 1 ? "nowa fiszka gotowa" : "nowych fiszek gotowych"} do nauki
          </span>
          <button
            type="button"
            onClick={() => {
              setShowGeneratedBanner(false);
            }}
            title="Zamknij"
            className="rounded-lg p-1 text-green-200 transition-colors hover:bg-green-500/20"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </p>
      )}

      {loadError ? (
        <p className="rounded-xl border border-red-400/30 bg-red-500/10 p-8 text-center text-sm text-red-200">
          Nie udało się wczytać fiszek. Odśwież stronę i spróbuj ponownie.
        </p>
      ) : cards.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-sm text-blue-100/40">
          Nie masz jeszcze żadnych fiszek.
        </p>
      ) : (
        <ul className="space-y-3">
          {cards.map((card) => {
            const isEditing = editingId === card.id;
            const isConfirming = confirmingId === card.id;
            const isPending = pendingId === card.id;

            return (
              <li key={card.id} className="rounded-xl border border-white/10 bg-white/5 p-4 text-white">
                <div className="mb-2">
                  <SourceBadge source={card.source} />
                </div>

                {isEditing ? (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label htmlFor={`question-${card.id}`} className="block text-xs text-blue-100/60">
                        Pytanie
                      </label>
                      <input
                        id={`question-${card.id}`}
                        value={draft.question}
                        onChange={(e) => {
                          setDraft((prev) => ({ ...prev, question: e.target.value }));
                        }}
                        className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor={`answer-${card.id}`} className="block text-xs text-blue-100/60">
                        Odpowiedź
                      </label>
                      <input
                        id={`answer-${card.id}`}
                        value={draft.answer}
                        onChange={(e) => {
                          setDraft((prev) => ({ ...prev, answer: e.target.value }));
                        }}
                        className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                      />
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => void saveEdit(card.id)}
                        className={cn(actionButton, "bg-purple-600 text-white hover:bg-purple-500")}
                      >
                        <Check className="size-4" />
                        {isPending ? "Zapisywanie…" : "Zapisz"}
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={cancelEdit}
                        className={cn(actionButton, "bg-white/10 text-blue-100 hover:bg-white/20")}
                      >
                        <X className="size-4" />
                        Anuluj
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="font-medium">{card.question}</p>
                    <p className="mt-1 text-sm text-blue-100/60">{card.answer}</p>

                    {isConfirming ? (
                      /* FR-025 wymaga kroku potwierdzenia przed usunięciem.
                         Potwierdzenie jest inline, a nie przez `window.confirm`:
                         natywny dialog blokuje wątek, nie da się go ostylować
                         i jest poza zasięgiem asercji Playwrighta. */
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="text-sm text-red-200">Usunąć tę fiszkę na stałe?</span>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => void confirmDelete(card.id)}
                          className={cn(actionButton, "bg-red-600 text-white hover:bg-red-500")}
                        >
                          <Trash2 className="size-4" />
                          {isPending ? "Usuwanie…" : "Tak, usuń"}
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => {
                            setConfirmingId(null);
                          }}
                          className={cn(actionButton, "bg-white/10 text-blue-100 hover:bg-white/20")}
                        >
                          Anuluj
                        </button>
                      </div>
                    ) : (
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            startEdit(card);
                          }}
                          className={cn(actionButton, "bg-white/10 text-blue-100 hover:bg-white/20")}
                        >
                          <Pencil className="size-4" />
                          Edytuj
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setError(null);
                            setEditingId(null);
                            setConfirmingId(card.id);
                          }}
                          className={cn(actionButton, "bg-white/10 text-red-200 hover:bg-red-500/20")}
                        >
                          <Trash2 className="size-4" />
                          Usuń
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
