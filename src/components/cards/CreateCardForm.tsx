import { useState } from "react";
import { BookOpen, AlignLeft, Plus, CheckCircle } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { cn } from "@/lib/utils";
import type { Card } from "@/types";

interface Props {
  onCardAdded?: (card: Card) => void;
}

export default function CreateCardForm({ onCardAdded }: Props) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [errors, setErrors] = useState<{ question?: string; answer?: string; server?: string }>({});
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  function validate() {
    const next: typeof errors = {};
    if (!question.trim()) next.question = "Question cannot be empty";
    if (!answer.trim()) next.answer = "Answer cannot be empty";
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
        body: JSON.stringify({ question: question.trim(), answer: answer.trim() }),
      });

      if (res.ok) {
        const card: Card = await res.json();
        onCardAdded?.(card);
        setQuestion("");
        setAnswer("");
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
        id="question"
        label="Question"
        value={question}
        onChange={(v) => {
          setQuestion(v);
          if (errors.question) setErrors((p) => ({ ...p, question: undefined }));
        }}
        placeholder="Question or term…"
        error={errors.question}
        icon={<BookOpen className="size-4" />}
      />

      <FormField
        id="answer"
        label="Answer"
        value={answer}
        onChange={(v) => {
          setAnswer(v);
          if (errors.answer) setErrors((p) => ({ ...p, answer: undefined }));
        }}
        placeholder="Answer or definition…"
        error={errors.answer}
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
