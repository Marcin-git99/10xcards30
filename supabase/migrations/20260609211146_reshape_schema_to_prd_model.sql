-- F-01: reshape schema to the PRD domain model.
-- Adds the generations table, reshapes cards (question/answer + SRS columns),
-- and installs an updated_at maintenance trigger on cards.
-- The original 20260604000000_create_cards.sql is left untouched.

-- 1. generations table.
--    Created BEFORE the cards reshape because cards.generation_id references it.
--    Stores only a non-reversible hash + length of the source text (PRD privacy NFR);
--    the source text itself is never persisted.
create table if not exists generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_text_hash text not null,
  source_text_length integer not null,
  created_at timestamptz not null default now()
);

alter table generations enable row level security;

create policy "users can insert their own generations"
  on generations for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users can select their own generations"
  on generations for select
  to authenticated
  using (user_id = auth.uid());

-- UPDATE/DELETE policies are intentionally omitted: generation records are
-- immutable, and deletion happens only via the auth.users ON DELETE CASCADE
-- (which bypasses RLS). RLS default-deny covers every operation the app never
-- performs.

-- 2. Reshape cards to the PRD model.
alter table cards rename column front to question;
alter table cards rename column back to answer;

-- Allow empty Q/A so manual empty cards (FR-028) can persist; columns stay NOT NULL.
alter table cards alter column question set default '';
alter table cards alter column answer set default '';

alter table cards
  add column source text not null default 'manual' check (source in ('ai', 'manual')),
  add column generation_id uuid references generations (id) on delete set null,
  add column leitner_box integer not null default 1 check (leitner_box between 1 and 5),
  add column next_review_at timestamptz not null default now();

-- The existing per-operation cards RLS policies reference user_id and are
-- unaffected by the column renames, so they are left in place.

-- 3. updated_at maintenance trigger on cards.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger cards_set_updated_at
  before update on cards
  for each row
  execute function set_updated_at();
