# Supabase temporary backend

The SQL migration enables RLS for the provider-neutral records, tombstones, and migration batches. Deploy the Edge Function with the Supabase CLI:

```powershell
supabase db push
supabase functions deploy virtue-api
```

Set `VIRTUE_API_URL` only if the function is configured as a forwarding boundary to the canonical API. Never put a service-role key in the browser or static build. The current function uses the authenticated Supabase user ID as `account_id` and the anon key plus the caller JWT, so RLS remains active.

Before production use, run the migration acceptance script against exports from both providers and retain the source export during the rollback window.
