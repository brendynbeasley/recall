-- Recall cloud sync: run this once in your Supabase project (Dashboard → SQL Editor → New query → Run).
-- One row per local record (sets, cards, notes, review history, settings…), private to each account.

create table if not exists public.records (
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  collection text    not null,
  id         text    not null,
  data       jsonb,
  deleted    boolean not null default false,
  updated_at bigint  not null,                                 -- client last-modified time (ms); newest wins
  synced_at  timestamptz not null default clock_timestamp(),   -- server time, used by devices to fetch changes
  primary key (user_id, collection, id)
);
create index if not exists records_user_synced on public.records (user_id, synced_at);

-- Row-level security: every account can only see and change its own rows
alter table public.records enable row level security;
drop policy if exists "Own records" on public.records;
create policy "Own records" on public.records for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Keep the newest version when two devices upload the same record, and stamp the server time
create or replace function public.records_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null; -- an older edit arrived late; keep what's stored
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists records_guard on public.records;
create trigger records_guard before insert or update on public.records
  for each row execute function public.records_guard();
