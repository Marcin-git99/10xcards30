export interface Card {
  id: string;
  user_id: string;
  question: string;
  answer: string;
  source: "ai" | "manual";
  generation_id: string | null;
  leitner_box: number;
  next_review_at: string;
  created_at: string;
  updated_at: string;
}

export interface Generation {
  id: string;
  user_id: string;
  source_text_hash: string;
  source_text_length: number;
  created_at: string;
}

export interface CreateCardDto {
  question: string;
  answer: string;
}
