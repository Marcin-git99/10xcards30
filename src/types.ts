export interface Card {
  id: string;
  user_id: string;
  front: string;
  back: string;
  created_at: string;
  updated_at: string;
}

export interface CreateCardDto {
  front: string;
  back: string;
}
