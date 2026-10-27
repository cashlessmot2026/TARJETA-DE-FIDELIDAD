-- Tarjetas de fidelidad · esquema Supabase
-- Todas las tablas tienen RLS activado y SIN políticas: el anon key solo puede
-- llamar a las funciones RPC de abajo (security definer).

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),      -- secreto del cliente (link de su tarjeta)
  code text not null unique,                                 -- código público: va en el QR / NFC
  name text not null,
  phone text,
  stars int not null default 0,
  nfc_uid text,                                              -- número de serie de la etiqueta NFC asignada
  created_at timestamptz not null default now()
);
alter table public.customers add column if not exists nfc_uid text;
alter table public.customers add column if not exists bonus_days int not null default 0;  -- días de regalo disponibles
create unique index if not exists customers_nfc_uid_idx on public.customers(nfc_uid) where nfc_uid is not null;

create table if not exists public.visits (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  delta int not null,
  kind text not null default 'scan',                         -- scan | nfc | manual | redeem
  note text,
  created_at timestamptz not null default now()
);
create index if not exists visits_customer_idx on public.visits(customer_id, created_at desc);

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  stars_required int not null check (stars_required > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  key text primary key,
  value text not null
);

alter table public.customers  enable row level security;
alter table public.visits     enable row level security;
alter table public.promotions enable row level security;
alter table public.settings   enable row level security;

insert into public.settings(key, value) values
  ('admin_pin_hash', extensions.crypt('1234', extensions.gen_salt('bf'))),
  ('goal', '10'),
  ('business_name', 'Mi Negocio'),
  ('brand_color', '#5CE1B0')
on conflict (key) do nothing;

-- Premios del gimnasio (se entregan automáticamente al completar los días)
delete from public.promotions where title in ('Café gratis', 'Postre de cortesía');
insert into public.promotions(title, description, stars_required)
select '1 día de regalo', 'Completa 7 días pagados y recibe 1 día gratis.', 7
where not exists (select 1 from public.promotions where title = '1 día de regalo');
insert into public.promotions(title, description, stars_required)
select '2 días de regalo', 'Completa 14 días pagados y recibe 2 días gratis.', 14
where not exists (select 1 from public.promotions where title = '2 días de regalo');
update public.settings set value = '14' where key = 'goal';

-- ───────── helpers ─────────
create or replace function public._pin_ok(p_pin text) returns boolean
language sql security definer set search_path = public, extensions as $$
  select exists (select 1 from settings
    where key = 'admin_pin_hash' and value = crypt(p_pin, value));
$$;

create or replace function public._require_admin(p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not _pin_ok(p_pin) then raise exception 'PIN incorrecto' using errcode = '28000'; end if;
end $$;

create or replace function public._setting(p_key text) returns text
language sql security definer set search_path = public as $$
  select value from settings where key = p_key;
$$;

-- ───────── cliente ─────────
create or replace function public.app_register(p_name text, p_phone text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v customers;
begin
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'Escribe tu nombre'; end if;
  insert into customers(name, phone, code)
  values (trim(p_name), nullif(trim(p_phone),''), upper(substr(encode(gen_random_bytes(6),'hex'),1,8)))
  returning * into v;
  return json_build_object('token', v.token, 'code', v.code);
end $$;

create or replace function public.app_get_card(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v customers;
begin
  select * into v from customers where token = p_token;
  if not found then return null; end if;
  return json_build_object(
    'name', v.name, 'code', v.code, 'stars', v.stars, 'bonus_days', v.bonus_days,
    'since', v.created_at,
    'goal', _setting('goal')::int,
    'business', _setting('business_name'),
    'color', _setting('brand_color'),
    'visits', coalesce((select json_agg(x) from (
        select created_at as at, delta, kind from visits
        where customer_id = v.id order by created_at desc limit 12) x), '[]'::json),
    'promos', coalesce((select json_agg(p) from (
        select id, title, description, stars_required from promotions
        where active order by stars_required) p), '[]'::json)
  );
end $$;

-- ───────── admin ─────────
create or replace function public.admin_check(p_pin text) returns boolean
language sql security definer set search_path = public, extensions as $$
  select _pin_ok(p_pin);
$$;

create or replace function public.admin_overview(p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_pin);
  return json_build_object(
    'customers', (select count(*) from customers),
    'stars_total', (select coalesce(sum(delta),0) from visits where delta > 0),
    'redeemed', (select count(*) from visits where kind = 'redeem'),
    'today', (select count(*) from visits where delta > 0 and created_at >= date_trunc('day', now())),
    'series', (select coalesce(json_agg(s order by s.day), '[]'::json) from (
        select d::date as day,
          (select count(*) from visits v where v.delta > 0 and v.created_at::date = d::date) as n
        from generate_series(current_date - 13, current_date, interval '1 day') d) s),
    'recent', (select coalesce(json_agg(r), '[]'::json) from (
        select c.name, v.delta, v.kind, v.created_at as at
        from visits v join customers c on c.id = v.customer_id
        order by v.created_at desc limit 8) r),
    'goal', _setting('goal')::int,
    'business', _setting('business_name'),
    'color', _setting('brand_color')
  );
end $$;

create or replace function public.admin_customers(p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_pin);
  return coalesce((select json_agg(c) from (
    select id, code, name, phone, stars, bonus_days, created_at, nfc_uid,
      (select max(created_at) from visits v where v.customer_id = customers.id) as last_visit
    from customers order by stars desc, created_at desc) c), '[]'::json);
end $$;

create or replace function public.admin_add_stars(p_pin text, p_code text, p_delta int default 1,
                                                 p_kind text default 'manual', p_note text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v customers; last_at timestamptz;
begin
  perform _require_admin(p_pin);
  select * into v from customers where code = upper(trim(p_code)) or id::text = trim(p_code) or nfc_uid = upper(trim(p_code));
  if not found then raise exception 'Tarjeta no encontrada'; end if;
  if p_kind in ('scan','nfc') then
    select max(created_at) into last_at from visits where customer_id = v.id and kind in ('scan','nfc');
    if last_at is not null and last_at > now() - interval '20 seconds' then
      raise exception 'Esta tarjeta ya se validó hace unos segundos';
    end if;
  end if;
  if v.stars + p_delta < 0 then raise exception 'El cliente no tiene tantas estrellas'; end if;
  update customers set stars = stars + p_delta where id = v.id returning * into v;
  insert into visits(customer_id, delta, kind, note) values (v.id, p_delta, p_kind, p_note);
  return json_build_object('name', v.name, 'stars', v.stars, 'code', v.code, 'delta', p_delta);
end $$;

create or replace function public.admin_redeem(p_pin text, p_code text, p_promo uuid)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v customers; pr promotions;
begin
  perform _require_admin(p_pin);
  select * into v from customers where code = upper(trim(p_code));
  if not found then raise exception 'Tarjeta no encontrada'; end if;
  select * into pr from promotions where id = p_promo and active;
  if not found then raise exception 'Promoción no disponible'; end if;
  if v.stars < pr.stars_required then raise exception 'Faltan % estrellas', pr.stars_required - v.stars; end if;
  update customers set stars = stars - pr.stars_required where id = v.id returning * into v;
  insert into visits(customer_id, delta, kind, note) values (v.id, -pr.stars_required, 'redeem', pr.title);
  return json_build_object('name', v.name, 'stars', v.stars, 'promo', pr.title);
end $$;

create or replace function public.admin_assign_nfc(p_pin text, p_code text, p_uid text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v customers; u text := nullif(upper(trim(p_uid)), '');
begin
  perform _require_admin(p_pin);
  select * into v from customers where code = upper(trim(p_code));
  if not found then raise exception 'Cliente no encontrado'; end if;
  if u is not null and exists (select 1 from customers where nfc_uid = u and id <> v.id) then
    raise exception 'Esa etiqueta ya está asignada a otro cliente';
  end if;
  update customers set nfc_uid = u where id = v.id;
  return json_build_object('name', v.name, 'nfc_uid', u);
end $$;

-- Gimnasio: pago de 7 días regala 1; pago de 14 días regala 2. 1 estrella = 1 día pagado.
create or replace function public.admin_lookup(p_pin text, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v customers;
begin
  perform _require_admin(p_pin);
  select * into v from customers
   where code = upper(trim(p_code)) or nfc_uid = upper(trim(p_code)) or id::text = trim(p_code);
  if not found then raise exception 'Tarjeta no encontrada'; end if;
  return json_build_object('name', v.name, 'code', v.code, 'stars', v.stars, 'bonus_days', v.bonus_days);
end $$;

create or replace function public.admin_register_payment(p_pin text, p_code text, p_days int)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v customers; gift int;
begin
  perform _require_admin(p_pin);
  if p_days not in (7, 14) then raise exception 'Plan no válido'; end if;
  gift := p_days / 7;
  select * into v from customers where code = upper(trim(p_code));
  if not found then raise exception 'Tarjeta no encontrada'; end if;
  update customers set stars = stars + p_days, bonus_days = bonus_days + gift
   where id = v.id returning * into v;
  insert into visits(customer_id, delta, kind, note)
  values (v.id, p_days, 'payment', p_days || ' días pagados + ' || gift || ' de regalo');
  return json_build_object('name', v.name, 'code', v.code, 'stars', v.stars, 'bonus_days', v.bonus_days, 'paid', p_days, 'gift', gift);
end $$;

-- Confirma el día pagado: +1 estrella. Al día 7 regala 1 día; al día 14 regala 2 y el ciclo reinicia.
create or replace function public.admin_confirm_day(p_pin text, p_code text, p_kind text default 'scan')
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v customers; last_at timestamptz; n int; gift int := 0;
begin
  perform _require_admin(p_pin);
  select * into v from customers
   where code = upper(trim(p_code)) or nfc_uid = upper(trim(p_code)) or id::text = trim(p_code);
  if not found then raise exception 'Tarjeta no encontrada'; end if;
  select max(created_at) into last_at from visits where customer_id = v.id and kind in ('scan','nfc','day');
  if last_at is not null and last_at > now() - interval '12 hours' then
    raise exception 'El día de % ya fue confirmado hoy', v.name;
  end if;
  n := case when v.stars >= 14 then 1 else v.stars + 1 end;
  if n = 7 then gift := 1; elsif n = 14 then gift := 2; end if;
  update customers set stars = n, bonus_days = bonus_days + gift where id = v.id returning * into v;
  insert into visits(customer_id, delta, kind, note)
  values (v.id, 1, case when p_kind = 'nfc' then 'nfc' else 'scan' end,
          'Día ' || n || ' pagado' || case when gift > 0 then ' · +' || gift || ' de regalo' else '' end);
  return json_build_object('name', v.name, 'code', v.code, 'stars', v.stars, 'bonus_days', v.bonus_days,
                           'day', n, 'gift', gift, 'completed', n = 14);
end $$;

create or replace function public.admin_use_bonus_day(p_pin text, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v customers;
begin
  perform _require_admin(p_pin);
  select * into v from customers where code = upper(trim(p_code));
  if not found then raise exception 'Tarjeta no encontrada'; end if;
  if v.bonus_days < 1 then raise exception 'No tiene días de regalo'; end if;
  update customers set bonus_days = bonus_days - 1 where id = v.id returning * into v;
  -- Al consumir el último día gratis se elimina la tarjeta y los datos del cliente.
  if v.bonus_days = 0 then
    delete from customers where id = v.id;
    return json_build_object('name', v.name, 'code', v.code, 'stars', 0, 'bonus_days', 0, 'closed', true);
  end if;
  insert into visits(customer_id, delta, kind, note) values (v.id, 0, 'bonus', 'Día de regalo usado');
  return json_build_object('name', v.name, 'code', v.code, 'stars', v.stars, 'bonus_days', v.bonus_days, 'closed', false);
end $$;

create or replace function public.admin_delete_customer(p_pin text, p_code text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_pin);
  delete from customers where code = upper(trim(p_code));
  if not found then raise exception 'Cliente no encontrado'; end if;
end $$;

create or replace function public.admin_promos(p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_pin);
  return coalesce((select json_agg(p) from (
    select * from promotions order by stars_required, created_at) p), '[]'::json);
end $$;

create or replace function public.admin_save_promo(p_pin text, p_id uuid, p_title text, p_desc text,
                                                  p_stars int, p_active boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_pin);
  if p_id is null then
    insert into promotions(title, description, stars_required, active) values (p_title, p_desc, p_stars, p_active);
  else
    update promotions set title = p_title, description = p_desc, stars_required = p_stars, active = p_active
    where id = p_id;
  end if;
end $$;

create or replace function public.admin_delete_promo(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_pin);
  delete from promotions where id = p_id;
end $$;

create or replace function public.admin_save_settings(p_pin text, p_business text, p_color text,
                                                     p_goal int, p_new_pin text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_pin);
  update settings set value = p_business where key = 'business_name';
  update settings set value = p_color where key = 'brand_color';
  update settings set value = p_goal::text where key = 'goal';
  if p_new_pin is not null and length(p_new_pin) >= 4 then
    update settings set value = crypt(p_new_pin, gen_salt('bf')) where key = 'admin_pin_hash';
  end if;
end $$;

-- Permisos: el anon key solo ejecuta las funciones públicas.
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.app_register(text, text), public.app_get_card(uuid),
  public.admin_check(text), public.admin_overview(text), public.admin_customers(text),
  public.admin_add_stars(text, text, int, text, text), public.admin_redeem(text, text, uuid),
  public.admin_assign_nfc(text, text, text), public.admin_lookup(text, text),
  public.admin_register_payment(text, text, int), public.admin_confirm_day(text, text, text), public.admin_use_bonus_day(text, text), public.admin_delete_customer(text, text), public.admin_promos(text), public.admin_save_promo(text, uuid, text, text, int, boolean),
  public.admin_delete_promo(text, uuid), public.admin_save_settings(text, text, text, int, text)
to anon, authenticated;

-- ───────── Planes elegibles (7 / 14 días, editables desde el admin) ─────────
alter table public.promotions add column if not exists reward_days int not null default 1;
update public.promotions set reward_days = 1 where stars_required = 7 and reward_days = 1;
update public.promotions set reward_days = 2 where stars_required = 14;
alter table public.customers add column if not exists plan_id uuid references public.promotions(id) on delete set null;
alter table public.customers add column if not exists cycle_gift int not null default 0;

create or replace function public._plan_of(p_plan uuid) returns public.promotions
language plpgsql security definer set search_path = public as $$
declare pr promotions;
begin
  select * into pr from promotions where id = p_plan and active;
  if not found then
    select * into pr from promotions where active order by stars_required limit 1;
  end if;
  return pr;
end $$;

create or replace function public.app_plans() returns json
language sql security definer set search_path = public as $$
  select coalesce(json_agg(p), '[]'::json) from (
    select id, title, description, stars_required, reward_days
    from promotions where active order by stars_required) p;
$$;

drop function if exists public.app_register(text, text);
create or replace function public.app_register(p_name text, p_phone text default null, p_plan uuid default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v customers; pr promotions;
begin
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'Escribe tu nombre'; end if;
  pr := _plan_of(p_plan);
  insert into customers(name, phone, code, plan_id)
  values (trim(p_name), nullif(trim(p_phone),''), upper(substr(encode(gen_random_bytes(6),'hex'),1,8)), pr.id)
  returning * into v;
  return json_build_object('token', v.token, 'code', v.code);
end $$;

create or replace function public.app_get_card(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v customers; pr promotions; nx promotions;
begin
  select * into v from customers where token = p_token;
  if not found then return null; end if;
  pr := _plan_of(v.plan_id);
  select * into nx from promotions where active and stars_required > pr.stars_required
   order by stars_required limit 1;
  return json_build_object(
    'name', v.name, 'code', v.code, 'stars', v.stars, 'bonus_days', v.bonus_days,
    'since', v.created_at,
    'goal', pr.stars_required,
    'plan', json_build_object('id', pr.id, 'title', pr.title, 'days', pr.stars_required, 'reward_days', pr.reward_days),
    'can_upgrade', (v.stars >= pr.stars_required and nx.id is not null),
    'next_plan', case when nx.id is null then null else
        json_build_object('id', nx.id, 'title', nx.title, 'days', nx.stars_required, 'reward_days', nx.reward_days) end,
    'business', _setting('business_name'),
    'color', _setting('brand_color'),
    'visits', coalesce((select json_agg(x) from (
        select created_at as at, delta, kind from visits
        where customer_id = v.id order by created_at desc limit 12) x), '[]'::json),
    'promos', coalesce((select json_agg(p) from (
        select id, title, description, stars_required, reward_days from promotions
        where active order by stars_required) p), '[]'::json)
  );
end $$;

create or replace function public.app_choose_plan(p_token uuid, p_plan uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v customers; pr promotions;
begin
  select * into v from customers where token = p_token;
  if not found then raise exception 'Tarjeta no encontrada'; end if;
  select * into pr from promotions where id = p_plan and active;
  if not found then raise exception 'Plan no disponible'; end if;
  if pr.stars_required <= v.stars then raise exception 'Ese plan ya está completo'; end if;
  update customers set plan_id = pr.id where id = v.id;
  return json_build_object('plan', pr.title, 'days', pr.stars_required);
end $$;

create or replace function public.admin_confirm_day(p_pin text, p_code text, p_kind text default 'scan')
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v customers; pr promotions; last_at timestamptz; n int; gift int := 0; cg int;
begin
  perform _require_admin(p_pin);
  select * into v from customers
   where code = upper(trim(p_code)) or nfc_uid = upper(trim(p_code)) or id::text = trim(p_code);
  if not found then raise exception 'Tarjeta no encontrada'; end if;
  select max(created_at) into last_at from visits where customer_id = v.id and kind in ('scan','nfc','day');
  if last_at is not null and last_at > now() - interval '12 hours' then
    raise exception 'El día de % ya fue confirmado hoy', v.name;
  end if;
  pr := _plan_of(v.plan_id);
  if v.stars >= pr.stars_required then n := 1; cg := 0; else n := v.stars + 1; cg := v.cycle_gift; end if;
  if n = pr.stars_required then gift := greatest(pr.reward_days - cg, 0); end if;
  update customers set stars = n, bonus_days = bonus_days + gift, cycle_gift = cg + gift
   where id = v.id returning * into v;
  insert into visits(customer_id, delta, kind, note)
  values (v.id, 1, case when p_kind = 'nfc' then 'nfc' else 'scan' end,
          'Día ' || n || ' pagado' || case when gift > 0 then ' · +' || gift || ' de regalo' else '' end);
  return json_build_object('name', v.name, 'code', v.code, 'stars', v.stars, 'bonus_days', v.bonus_days,
                           'day', n, 'target', pr.stars_required, 'gift', gift, 'completed', n = pr.stars_required);
end $$;

create or replace function public.admin_customers(p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_pin);
  return coalesce((select json_agg(c) from (
    select id, code, name, phone, stars, bonus_days, created_at, nfc_uid,
      (select title from promotions p where p.id = customers.plan_id) as plan_title,
      (select max(created_at) from visits v where v.customer_id = customers.id) as last_visit
    from customers order by stars desc, created_at desc) c), '[]'::json);
end $$;

drop function if exists public.admin_save_promo(text, uuid, text, text, int, boolean);
create or replace function public.admin_save_promo(p_pin text, p_id uuid, p_title text, p_desc text,
                                                  p_stars int, p_active boolean, p_reward int default 1)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_pin);
  if p_reward < 0 then raise exception 'Los días de regalo no pueden ser negativos'; end if;
  if p_id is null then
    insert into promotions(title, description, stars_required, active, reward_days)
    values (p_title, p_desc, p_stars, p_active, p_reward);
  else
    update promotions set title = p_title, description = p_desc, stars_required = p_stars,
      active = p_active, reward_days = p_reward where id = p_id;
  end if;
end $$;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.app_register(text, text, uuid), public.app_get_card(uuid), public.app_plans(), public.app_choose_plan(uuid, uuid),
  public.admin_check(text), public.admin_overview(text), public.admin_customers(text),
  public.admin_add_stars(text, text, int, text, text), public.admin_redeem(text, text, uuid),
  public.admin_assign_nfc(text, text, text), public.admin_lookup(text, text),
  public.admin_register_payment(text, text, int), public.admin_confirm_day(text, text, text),
  public.admin_use_bonus_day(text, text), public.admin_delete_customer(text, text), public.admin_promos(text),
  public.admin_save_promo(text, uuid, text, text, int, boolean, int),
  public.admin_delete_promo(text, uuid), public.admin_save_settings(text, text, text, int, text)
to anon, authenticated;

-- ───────── Premios definidos por el admin (solo se ven cuando el admin los autoriza) ─────────
create table if not exists public.rewards (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  stars_required int check (stars_required is null or stars_required > 0),  -- opcional
  visible boolean not null default false,                                    -- autorizado por el admin
  created_at timestamptz not null default now()
);
alter table public.rewards enable row level security;

create or replace function public.admin_rewards(p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_pin);
  return coalesce((select json_agg(r) from (
    select * from rewards order by stars_required nulls last, created_at) r), '[]'::json);
end $$;

create or replace function public.admin_save_reward(p_pin text, p_id uuid, p_title text, p_desc text,
                                                   p_stars int, p_visible boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_pin);
  if length(trim(coalesce(p_title,''))) < 2 then raise exception 'Escribe el nombre del premio'; end if;
  if p_id is null then
    insert into rewards(title, description, stars_required, visible)
    values (trim(p_title), nullif(trim(p_desc),''), p_stars, coalesce(p_visible, false));
  else
    update rewards set title = trim(p_title), description = nullif(trim(p_desc),''),
      stars_required = p_stars, visible = coalesce(p_visible, false) where id = p_id;
  end if;
end $$;

create or replace function public.admin_set_reward_visible(p_pin text, p_id uuid, p_visible boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_pin);
  update rewards set visible = p_visible where id = p_id;
end $$;

create or replace function public.admin_delete_reward(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_admin(p_pin);
  delete from rewards where id = p_id;
end $$;

-- app_get_card ahora incluye solo los premios autorizados (visible = true).
create or replace function public.app_get_card(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v customers; pr promotions; nx promotions;
begin
  select * into v from customers where token = p_token;
  if not found then return null; end if;
  pr := _plan_of(v.plan_id);
  select * into nx from promotions where active and stars_required > pr.stars_required
   order by stars_required limit 1;
  return json_build_object(
    'name', v.name, 'code', v.code, 'stars', v.stars, 'bonus_days', v.bonus_days,
    'since', v.created_at,
    'goal', pr.stars_required,
    'plan', json_build_object('id', pr.id, 'title', pr.title, 'days', pr.stars_required, 'reward_days', pr.reward_days),
    'can_upgrade', (v.stars >= pr.stars_required and nx.id is not null),
    'next_plan', case when nx.id is null then null else
        json_build_object('id', nx.id, 'title', nx.title, 'days', nx.stars_required, 'reward_days', nx.reward_days) end,
    'business', _setting('business_name'),
    'color', _setting('brand_color'),
    'visits', coalesce((select json_agg(x) from (
        select created_at as at, delta, kind from visits
        where customer_id = v.id order by created_at desc limit 12) x), '[]'::json),
    'promos', coalesce((select json_agg(p) from (
        select id, title, description, stars_required, reward_days from promotions
        where active order by stars_required) p), '[]'::json),
    'rewards', coalesce((select json_agg(r) from (
        select id, title, description, stars_required from rewards
        where visible order by stars_required nulls last, created_at) r), '[]'::json)
  );
end $$;

revoke all on function public.admin_rewards(text), public.admin_save_reward(text, uuid, text, text, int, boolean),
  public.admin_set_reward_visible(text, uuid, boolean), public.admin_delete_reward(text, uuid) from public, anon, authenticated;
grant execute on function
  public.admin_rewards(text), public.admin_save_reward(text, uuid, text, text, int, boolean),
  public.admin_set_reward_visible(text, uuid, boolean), public.admin_delete_reward(text, uuid)
to anon, authenticated;

-- ⚠️ Continúa en supabase/multinegocio.sql (varios negocios). Ese archivo reemplaza las funciones de admin de arriba.
