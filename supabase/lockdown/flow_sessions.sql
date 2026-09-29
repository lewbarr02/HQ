-- flow_sessions lock / unlock, to be applied alongside the rest of the
-- Supabase auth/RLS lockdown. Replace <LEWIS_AUTH_UUID> with Lewis's auth user id.
-- Edge functions (flow-checkin, flow-reply) use the service role and are unaffected.

-- ── LOCK ──────────────────────────────────────────────────────────────
drop policy if exists "allow all for lewis" on public.flow_sessions;
drop policy if exists "owner only" on public.flow_sessions;
create policy "owner only" on public.flow_sessions
  for all to authenticated
  using (auth.uid() = '<LEWIS_AUTH_UUID>'::uuid and user_id = 'lewis')
  with check (auth.uid() = '<LEWIS_AUTH_UUID>'::uuid and user_id = 'lewis');
revoke all on public.flow_sessions from anon;

-- ── UNLOCK (undo) ─────────────────────────────────────────────────────
-- drop policy if exists "owner only" on public.flow_sessions;
-- create policy "allow all for lewis" on public.flow_sessions
--   for all using (user_id = 'lewis') with check (user_id = 'lewis');
-- grant all on public.flow_sessions to anon;
