import { useState } from "react";
import { Library, Plus, Sparkles, PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Card } from "@/types";

interface Props {
  initialCards: Card[];
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

export default function LibraryView({ initialCards }: Props) {
  const [cards] = useState<Card[]>(initialCards);

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

      {cards.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-sm text-blue-100/40">
          Nie masz jeszcze żadnych fiszek.
        </p>
      ) : (
        <ul className="space-y-3">
          {cards.map((card) => (
            <li
              key={card.id}
              className="rounded-xl border border-white/10 bg-white/5 p-4 text-white"
            >
              <div className="mb-2">
                <SourceBadge source={card.source} />
              </div>
              <p className="font-medium">{card.question}</p>
              <p className="mt-1 text-sm text-blue-100/60">{card.answer}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
