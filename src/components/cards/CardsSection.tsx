import { useState } from "react";
import { Layers } from "lucide-react";
import CreateCardForm from "@/components/cards/CreateCardForm";
import type { Card } from "@/types";

interface Props {
  initialCards: Card[];
}

export default function CardsSection({ initialCards }: Props) {
  const [cards, setCards] = useState<Card[]>(initialCards);

  function handleCardAdded(card: Card) {
    setCards((prev) => [card, ...prev]);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 text-lg font-semibold text-white">New flashcard</h2>
        <CreateCardForm onCardAdded={handleCardAdded} />
      </div>

      {cards.length > 0 && (
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
            <Layers className="size-5" />
            Your cards
            <span className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-sm font-normal text-blue-100/60">
              {cards.length}
            </span>
          </h2>
          <ul className="space-y-2">
            {cards.map((card) => (
              <li
                key={card.id}
                className="rounded-xl border border-white/10 bg-white/5 p-4 text-white"
              >
                <p className="font-medium">{card.front}</p>
                <p className="mt-1 text-sm text-blue-100/60">{card.back}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cards.length === 0 && (
        <p className="text-center text-sm text-blue-100/40">No cards yet — add your first one above.</p>
      )}
    </div>
  );
}
