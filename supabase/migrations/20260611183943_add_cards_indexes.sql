-- Review fix F3 (db-schema-mvp impl-review): indexes Postgres does not create
-- automatically for FKs / future query paths.
-- cards.generation_id: speeds up ON DELETE SET NULL when a generations row is
-- removed (otherwise a seq scan over cards).
create index cards_generation_id_idx on cards (generation_id);

-- cards (user_id, next_review_at): supports the S-02 "due cards" query
-- (where user_id = auth.uid() and next_review_at <= now()).
create index cards_user_id_next_review_at_idx on cards (user_id, next_review_at);
