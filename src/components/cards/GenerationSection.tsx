import { useState } from "react";
import { Sparkles, X, RotateCcw, CheckCircle2 } from "lucide-react";

const MIN_LENGTH = 500;
const MAX_LENGTH = 5000;

interface FlashcardCandidate {
  question: string;
  answer: string;
}

type Phase = "idle" | "generating" | "review" | "approving";

/**
 * Kształt błędu współdzielony z `CreateCardForm`/`LibraryView`: `error` bywa
 * stringiem albo obiektem zoda — bez rozróżnienia React dostaje obiekt jako
 * child i wyspa pada (patrz F5/F2 w context/archive/2026-06-09-db-schema-mvp).
 */
interface ApiErrorBody {
  error?: unknown;
}

async function describeFailure(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return typeof body.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export default function GenerationSection() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [sourceText, setSourceText] = useState("");
  const [candidates, setCandidates] = useState<FlashcardCandidate[]>([]);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canGenerate = sourceText.length >= MIN_LENGTH && sourceText.length <= MAX_LENGTH;
  const canApprove =
    candidates.length > 0 && candidates.every((c) => c.question.trim() !== "" && c.answer.trim() !== "");

  async function handleGenerate() {
    setPhase("generating");
    setError(null);

    try {
      const res = await fetch("/api/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_text: sourceText }),
      });

      if (!res.ok) {
        setError(await describeFailure(res, "Nie udało się wygenerować fiszek."));
        setPhase("idle");
        return;
      }

      const data = (await res.json()) as { generation_id: string; cards: FlashcardCandidate[] };
      setGenerationId(data.generation_id);
      setCandidates(data.cards);
      setPhase("review");
    } catch {
      setError("Brak połączenia z serwerem — spróbuj ponownie.");
      setPhase("idle");
    }
  }

  async function handleApprove() {
    if (!generationId) return;

    setPhase("approving");
    setError(null);

    try {
      const res = await fetch(`/api/generations/${generationId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cards: candidates }),
      });

      if (!res.ok) {
        setError(await describeFailure(res, "Nie udało się zatwierdzić fiszek."));
        setPhase("review");
        return;
      }

      const data = (await res.json()) as { cards: unknown[] };
      window.location.href = `/library?generated=${String(data.cards.length)}`;
    } catch {
      setError("Brak połączenia z serwerem — spróbuj ponownie.");
      setPhase("review");
    }
  }

  function updateCandidate(index: number, field: keyof FlashcardCandidate, value: string) {
    setCandidates((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }

  function removeCandidate(index: number) {
    setCandidates((prev) => prev.filter((_, i) => i !== index));
  }

  const isPasteView = phase === "idle" || phase === "generating";

  return (
    <div className="space-y-4 border-b border-white/10 pb-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
        <Sparkles className="size-5" />
        Generuj fiszki z AI
      </h2>

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200"
        >
          <span>{error}</span>
          {isPasteView && (
            <button
              type="button"
              onClick={() => void handleGenerate()}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-1.5 font-medium text-red-100 transition-colors hover:bg-red-500/30"
            >
              <RotateCcw className="size-3.5" />
              Spróbuj ponownie
            </button>
          )}
        </div>
      )}

      {isPasteView ? (
        <div className="space-y-2">
          <textarea
            value={sourceText}
            onChange={(e) => {
              setSourceText(e.target.value);
            }}
            disabled={phase === "generating"}
            rows={6}
            placeholder="Wklej tekst źródłowy (500–5000 znaków)…"
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 focus:ring-2 focus:ring-purple-400 focus:outline-none disabled:opacity-50"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-blue-100/60">
              {sourceText.length} / {MAX_LENGTH} znaków (min. {MIN_LENGTH})
            </span>
            <button
              type="button"
              disabled={!canGenerate || phase === "generating"}
              onClick={() => void handleGenerate()}
              className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === "generating" ? (
                <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {phase === "generating" ? "Generowanie…" : "Generuj fiszki z AI"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-3">
            {candidates.map((candidate, index) => (
              <li key={index} className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 space-y-2">
                    <input
                      value={candidate.question}
                      onChange={(e) => {
                        updateCandidate(index, "question", e.target.value);
                      }}
                      placeholder="Pytanie"
                      className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                    />
                    <input
                      value={candidate.answer}
                      onChange={(e) => {
                        updateCandidate(index, "answer", e.target.value);
                      }}
                      placeholder="Odpowiedź"
                      className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-blue-100/80"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      removeCandidate(index);
                    }}
                    title="Usuń tę propozycję"
                    className="rounded-lg p-1.5 text-red-200 transition-colors hover:bg-red-500/20"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {candidates.length === 0 && (
            <p className="text-center text-sm text-blue-100/40">Wszystkie propozycje zostały usunięte.</p>
          )}

          <button
            type="button"
            disabled={!canApprove || phase === "approving"}
            onClick={() => void handleApprove()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === "approving" ? (
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {phase === "approving" ? "Zatwierdzanie…" : "Zatwierdź i przejdź do nauki"}
          </button>
        </div>
      )}
    </div>
  );
}
