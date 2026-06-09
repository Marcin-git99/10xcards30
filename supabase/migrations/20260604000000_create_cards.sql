create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  front text not null,
  back text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table cards enable row level security;

create policy "users can insert their own cards"
  on cards for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users can select their own cards"
  on cards for select
  to authenticated
  using (user_id = auth.uid());

create policy "users can update their own cards"
  on cards for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users can delete their own cards"
  on cards for delete
  to authenticated
  using (user_id = auth.uid());
