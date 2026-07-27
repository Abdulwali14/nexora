-- ============================================================================
--  NEXORA — database schema  (paste this whole file into Supabase SQL Editor)
--  Security model in one line: users can READ their own row, but the ONLY way
--  money moves is through submit_answer(), which grades server-side. No client
--  can write its own balance, flip the kill switch, or read the answer key.
-- ============================================================================

-- ---------- PROFILES --------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  role        text    not null default 'earner',      -- 'earner' | 'operator'
  balance     numeric not null default 0,             -- lifetime withdrawable $
  week_earned numeric not null default 0,
  week_start  date,
  verified    boolean not null default false,         -- KYC passed
  paused      boolean not null default false,         -- operator per-user pause
  hold        boolean not null default false,         -- payout hold
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- everyone can read THEIR OWN row; operators can read everyone
create policy "read own profile"    on public.profiles for select
  using ( id = auth.uid() );
create policy "operator reads all"  on public.profiles for select
  using ( exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'operator') );
-- only operators may update rows (pause / hold / etc.). Regular users update
-- nothing directly — balance & verified change only via the functions below.
create policy "operator updates all" on public.profiles for update
  using ( exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'operator') );

-- auto-create a profile whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- PLATFORM SETTINGS (the global kill switch) ----------------------
create table if not exists public.platform_settings (
  id            int primary key default 1,
  global_paused boolean not null default false,
  weekly_cap    numeric not null default 200,
  updated_at    timestamptz not null default now(),
  constraint single_row check (id = 1)
);
alter table public.platform_settings enable row level security;
insert into public.platform_settings (id) values (1) on conflict do nothing;

create policy "anyone reads settings" on public.platform_settings for select using ( true );
create policy "operator writes settings" on public.platform_settings for update
  using ( exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'operator') );

-- ---------- TASK TEMPLATES --------------------------------------------------
-- reference (the answer key) lives here and is NEVER exposed to earners.
create table if not exists public.task_templates (
  id        uuid primary key default gen_random_uuid(),
  category  text    not null,   -- stocks | pref | scale | vision | fashion
  prompt    text    not null,
  body      text    not null,
  options   jsonb   not null,   -- ["Positive","Neutral","Negative"]
  reference jsonb   not null,   -- {"kind":"equals","value":"Positive"} etc.
  pay       numeric not null,
  est       numeric not null default 1.5,
  active    boolean not null default true
);
alter table public.task_templates enable row level security;
-- base table: only operators can read/write (keeps the answer key hidden)
create policy "operator manages templates" on public.task_templates for all
  using ( exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'operator') );

-- earners read tasks through this view, which OMITS the reference column
create or replace view public.public_tasks
with (security_invoker = off) as
  select id, category, prompt, body, options, pay, est
  from public.task_templates where active = true;
grant select on public.public_tasks to authenticated;

-- ---------- SUBMISSIONS (ledger) --------------------------------------------
create table if not exists public.submissions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  template_id uuid not null references public.task_templates(id),
  answer      jsonb,
  verdict     text,
  award       numeric,
  created_at  timestamptz not null default now()
);
alter table public.submissions enable row level security;
create policy "read own submissions" on public.submissions for select
  using ( user_id = auth.uid() );
-- no INSERT policy: rows are only created by submit_answer() (security definer)

-- ============================================================================
--  submit_answer() — the ONLY money path. Grades server-side, enforces the
--  kill switch / pause / weekly cap, and awards atomically.
-- ============================================================================
create or replace function public.submit_answer(p_template_id uuid, p_answer jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me        public.profiles;
  tpl       public.task_templates;
  cap       numeric;
  paused_g  boolean;
  ref       jsonb;
  verdict   text := 'incorrect';
  mult      numeric := 0;
  award     numeric := 0;
  n         int;
  truth     jsonb;
  hits      int;
  wrong     int;
  this_week date := date_trunc('week', now())::date;
begin
  select * into me from public.profiles where id = auth.uid();
  if me is null then raise exception 'no profile'; end if;

  select global_paused, weekly_cap into paused_g, cap from public.platform_settings where id = 1;
  if paused_g then raise exception 'platform paused'; end if;
  if me.paused then raise exception 'account paused'; end if;

  -- weekly rollover
  if me.week_start is distinct from this_week then
    me.week_earned := 0;
    update public.profiles set week_earned = 0, week_start = this_week where id = me.id;
  end if;
  if me.week_earned >= cap then raise exception 'weekly cap reached'; end if;

  select * into tpl from public.task_templates where id = p_template_id and active = true;
  if tpl is null then raise exception 'task not found'; end if;
  ref := tpl.reference;

  -- ---- grade ----
  if ref->>'kind' = 'equals' then
    if (p_answer #>> '{}') = (ref->>'value') then verdict := 'correct'; mult := 1; end if;

  elsif ref->>'kind' = 'band' then
    n := (p_answer #>> '{}')::int;
    if n between (ref->>'lo')::int and (ref->>'hi')::int then verdict := 'correct'; mult := 1;
    elsif n = (ref->>'lo')::int - 1 or n = (ref->>'hi')::int + 1 then verdict := 'partial'; mult := 0.5;
    end if;

  elsif ref->>'kind' = 'tags' then
    truth := ref->'tags';
    select count(*) into hits from jsonb_array_elements_text(truth) t
      where p_answer ? t;
    select count(*) into wrong from jsonb_array_elements_text(p_answer) a
      where not (truth @> to_jsonb(a));
    if hits = jsonb_array_length(truth) and wrong = 0 then verdict := 'correct'; mult := 1;
    elsif hits >= jsonb_array_length(truth) - 1 and wrong <= 1 then verdict := 'partial'; mult := 0.5;
    end if;
  end if;

  award := round(tpl.pay * mult, 2);
  -- never let a single task push earnings past the weekly cap
  if me.week_earned + award > cap then award := round(cap - me.week_earned, 2); end if;

  update public.profiles
     set balance = balance + award,
         week_earned = week_earned + award
   where id = me.id
   returning balance, week_earned into me.balance, me.week_earned;

  insert into public.submissions (user_id, template_id, answer, verdict, award)
  values (me.id, tpl.id, p_answer, verdict, award);

  return jsonb_build_object(
    'verdict', verdict, 'award', award,
    'balance', me.balance, 'week_earned', me.week_earned);
end; $$;
grant execute on function public.submit_answer(uuid, jsonb) to authenticated;

-- mark the current user verified. In production your KYC provider's webhook
-- (Stripe Identity / Persona) calls this after a real ID check passes.
create or replace function public.mark_verified()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set verified = true where id = auth.uid();
end; $$;
grant execute on function public.mark_verified() to authenticated;

-- ============================================================================
--  SEED TASKS
-- ============================================================================
insert into public.task_templates (category, prompt, body, options, reference, pay, est) values
('stocks','What sentiment does this headline carry?','$NVDA smashes revenue estimates and lifts guidance on AI demand','["Positive","Neutral","Negative"]','{"kind":"equals","value":"Positive"}',0.13,1.3),
('stocks','What sentiment does this headline carry?','$META ad revenue slumps as major advertisers cut spend','["Positive","Neutral","Negative"]','{"kind":"equals","value":"Negative"}',0.13,1.3),
('stocks','What sentiment does this headline carry?','$AMZN names new CFO; company reaffirms prior full-year outlook','["Positive","Neutral","Negative"]','{"kind":"equals","value":"Neutral"}',0.13,1.3),
('stocks','What sentiment does this headline carry?','$TSLA delivers record quarter as margins expand sharply','["Positive","Neutral","Negative"]','{"kind":"equals","value":"Positive"}',0.13,1.3),
('stocks','What sentiment does this headline carry?','$AMD warns of chip oversupply and guides below estimates','["Positive","Neutral","Negative"]','{"kind":"equals","value":"Negative"}',0.13,1.3),
('pref','Question: "How do I reset my password?"  Which response is more helpful?','A — Open Settings, Security, Reset password, then follow the emailed link.\nB — Just reset it if you forgot it.','["Response A","Response B","Both bad"]','{"kind":"equals","value":"Response A"}',0.18,1.8),
('pref','Question: "Is it safe to mix bleach and ammonia?"  Which response is more helpful?','A — Sure, that is fine.\nB — No, it releases toxic gas. Never combine them.','["Response A","Response B","Both bad"]','{"kind":"equals","value":"Response B"}',0.18,1.8),
('pref','Question: "What is the capital of Australia?"  Which response is more helpful?','A — Sydney is the capital of Australia.\nB — Canberra is the capital of Australia.','["Response A","Response B","Both bad"]','{"kind":"equals","value":"Response B"}',0.18,1.8),
('scale','How natural does this sound? (1 = robotic, 5 = human)','"Delighted to inform you your package hath commenced its journey toward your domicile."','["1","2","3","4","5"]','{"kind":"band","lo":1,"hi":2}',0.11,1.1),
('scale','How natural does this sound? (1 = robotic, 5 = human)','"Hey! Your order just shipped, should reach you in a couple of days."','["1","2","3","4","5"]','{"kind":"band","lo":4,"hi":5}',0.11,1.1),
('scale','How natural does this sound? (1 = robotic, 5 = human)','"The utilization of the product facilitates optimal outcome maximization."','["1","2","3","4","5"]','{"kind":"band","lo":1,"hi":2}',0.11,1.1),
('vision','Select every tag that applies to the image.','A man in a raincoat waits at a bus stop beside a parked taxi on a rainy afternoon.','["Person","Animal","Vehicle","Food/Drink","Outdoor","Nighttime","Indoor","Text/Sign"]','{"kind":"tags","tags":["Person","Vehicle","Outdoor"]}',0.22,2.2),
('vision','Select every tag that applies to the image.','Two children eat ice cream at a kitchen table inside a bright home.','["Person","Animal","Vehicle","Food/Drink","Outdoor","Nighttime","Indoor","Text/Sign"]','{"kind":"tags","tags":["Person","Food/Drink","Indoor"]}',0.22,2.2),
('vision','Select every tag that applies to the image.','A cyclist rides past a glowing neon diner sign after dark.','["Person","Animal","Vehicle","Food/Drink","Outdoor","Nighttime","Indoor","Text/Sign"]','{"kind":"tags","tags":["Person","Vehicle","Outdoor","Nighttime","Text/Sign"]}',0.22,2.2),
('fashion','Which photo is better for an e-commerce listing?','Photo A: item laid flat on white, slightly out of focus.\nPhoto B: worn by a model in natural light, sharp and true to color.','["Photo A","Photo B","About equal"]','{"kind":"equals","value":"Photo B"}',0.14,1.4),
('fashion','Which photo is better for an e-commerce listing?','Photo A: crisp studio shot on white, accurate color.\nPhoto B: dim mirror selfie with a strong color cast.','["Photo A","Photo B","About equal"]','{"kind":"equals","value":"Photo A"}',0.14,1.4)
on conflict do nothing;
