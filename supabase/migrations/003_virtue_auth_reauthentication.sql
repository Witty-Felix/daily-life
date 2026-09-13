create table if not exists public.virtue_auth_reauth (
  account_id uuid not null references auth.users(id) on delete cascade,
  proof_hash text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.virtue_auth_reauth enable row level security;
drop policy if exists "virtue reauth own rows" on public.virtue_auth_reauth;
create policy "virtue reauth own rows" on public.virtue_auth_reauth
  for all using (account_id = auth.uid()) with check (account_id = auth.uid());
create index if not exists virtue_auth_reauth_expiry on public.virtue_auth_reauth(account_id, expires_at);
