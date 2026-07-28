-- ============================================================================
--  FIX: infinite recursion in profiles RLS policies (error 42P17)
--
--  The original operator policies on public.profiles queried public.profiles
--  inside their own USING clause. Postgres re-evaluates the policy for that
--  inner read, which re-evaluates the policy, forever. Every read of profiles
--  returned HTTP 500, so the app hung on "Loading…" after sign-in.
--
--  The fix: check the operator role inside a SECURITY DEFINER function. It runs
--  as the function owner, which is not subject to the table's RLS, so the check
--  no longer re-enters the policy. Same security guarantee -- the role still
--  comes from the database, never from the browser.
-- ============================================================================

create or replace function public.is_operator()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'operator'
  );
$$;
grant execute on function public.is_operator() to authenticated;

-- ---------- PROFILES: replace the two recursive policies -------------------
drop policy if exists "operator reads all"   on public.profiles;
drop policy if exists "operator updates all" on public.profiles;

create policy "operator reads all" on public.profiles for select
  using ( public.is_operator() );

create policy "operator updates all" on public.profiles for update
  using ( public.is_operator() );

-- ---------- Other tables: same helper, so they stop re-entering profiles ----
drop policy if exists "operator writes settings" on public.platform_settings;
create policy "operator writes settings" on public.platform_settings for update
  using ( public.is_operator() );

drop policy if exists "operator manages templates" on public.task_templates;
create policy "operator manages templates" on public.task_templates for all
  using ( public.is_operator() );
