create table if not exists public.virtue_records (
  account_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  date date not null,
  type text not null check (type in ('good','fault')),
  description text not null check (char_length(trim(description)) > 0),
  reflection text,
  corrections jsonb not null default '[]'::jsonb,
  version integer not null default 1 check (version > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, id)
);
create index if not exists virtue_records_visible_date on public.virtue_records(account_id, deleted_at, date, id);
create table if not exists public.virtue_purged_records (
  account_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  purged_at timestamptz not null default now(),
  primary key (account_id, id)
);
create table if not exists public.virtue_migration_batches (
  account_id uuid not null references auth.users(id) on delete cascade,
  batch_id text not null,
  result jsonb not null,
  committed_at timestamptz not null default now(),
  primary key (account_id, batch_id)
);
alter table public.virtue_records enable row level security;
alter table public.virtue_purged_records enable row level security;
alter table public.virtue_migration_batches enable row level security;
create policy "virtue records own rows" on public.virtue_records for all using (account_id = auth.uid()) with check (account_id = auth.uid());
create policy "virtue purged own rows" on public.virtue_purged_records for all using (account_id = auth.uid()) with check (account_id = auth.uid());
create policy "virtue batches own rows" on public.virtue_migration_batches for all using (account_id = auth.uid()) with check (account_id = auth.uid());
