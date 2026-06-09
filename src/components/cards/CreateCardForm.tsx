import { useState } from "react";
import { BookOpen, AlignLeft, Plus, CheckCircle } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { cn } from "@/lib/utils";
import type { Card } from "@/types";

interface Props {
  onCardAdded?: (card: Card) => void;
}

export default function CreateCardForm({ onCardAdded }: Props) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [errors, setErrors] = useState<{ front?: string; back?: string; server?: string }>({});
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  function validate() {
    const next: typeof errors = {};
    if (!front.trim()) next.front = "Front cannot be empty";
    if (!back.trim()) next.back = "Back cannot be empty";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setErrors({});
    setSuccess(false);

    try {
      const res = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front: front.trim(), back: back.trim() }),
      });

      if (res.ok) {
        const card: Card = await res.json();
        onCardAdded?.(card);
        setFront("");
        setBack("");
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        const data = await res.json();
        setErrors({ server: data.error ?? "Something went wrong" });
      }
    } catch {
      setErrors({ server: "Network error — please try again" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormField
        id="front"
        label="Front"
        value={front}
        onChange={(v) => {
          setFront(v);
          if (errors.front) setErrors((p) => ({ ...p, front: undefined }));
        }}
        placeholder="Question or term…"
        error={errors.front}
        icon={<BookOpen className="size-4" />}
      />

      <FormField
        id="back"
        label="Back"
        value={back}
        onChange={(v) => {
          setBack(v);
          if (errors.back) setErrors((p) => ({ ...p, back: undefined }));
        }}
        placeholder="Answer or definition…"
        error={errors.back}
        icon={<AlignLeft className="size-4" />}
      />

      {errors.server && (
        <p className="text-sm text-red-300">{errors.server}</p>
      )}

      {success && (
        <p className={cn("flex items-center gap-2 text-sm text-green-300")}>
          <CheckCircle className="size-4" /> Card saved!
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-50"
      >
        {loading ? (
          <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : (
          <Plus className="size-4" />
        )}
        {loading ? "Saving…" : "Add card"}
      </button>
    </form>
  );
}
