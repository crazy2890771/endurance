-- KIM ENDURANCE LAB — optional cloud sync schema for Supabase.
-- Run this once in the Supabase SQL editor of YOUR OWN project.
-- Every row is owned by the signed-in user and protected by Row Level Security.

create table if not exists public.kel_records (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  table_name        text        not null check (table_name in ('workouts', 'duties', 'dutyTypes', 'templates')),
  id                text        not null,
  data              jsonb       not null,
  updated_at        timestamptz not null,           -- client edit time (last-write-wins)
  deleted           boolean     not null default false,
  server_updated_at timestamptz not null default now(), -- pull cursor, always server time
  primary key (user_id, table_name, id)
);

create index if not exists kel_records_pull_idx on public.kel_records (user_id, server_updated_at);

alter table public.kel_records enable row level security;

drop policy if exists "own rows: select" on public.kel_records;
drop policy if exists "own rows: insert" on public.kel_records;
drop policy if exists "own rows: update" on public.kel_records;
drop policy if exists "own rows: delete" on public.kel_records;

create policy "own rows: select" on public.kel_records for select using (auth.uid() = user_id);
create policy "own rows: insert" on public.kel_records for insert with check (auth.uid() = user_id);
create policy "own rows: update" on public.kel_records for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows: delete" on public.kel_records for delete using (auth.uid() = user_id);

-- Server-side last-write-wins: ignore an update carrying an older client edit,
-- and always stamp the pull cursor with server time.
create or replace function public.kel_records_lww()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null; -- keep the newer row untouched
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists kel_records_lww on public.kel_records;
create trigger kel_records_lww
before insert or update on public.kel_records
for each row execute function public.kel_records_lww();
