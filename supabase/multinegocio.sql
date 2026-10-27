-- ═════════════════════════════════════════════════════════════════════════════
-- MULTI-NEGOCIO: el superadmin crea negocios; cada negocio tiene su admin (enlace + PIN),
-- sus clientes, planes y premios. Los datos existentes pasan al negocio «principal».
-- Pegar completo en Supabase → SQL Editor → Run. Se puede ejecutar más de una vez.
-- ═════════════════════════════════════════════════════════════════════════════

-- Premios (por si aún no se aplicó el bloque anterior de premios)
create table if not exists public.rewards (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  stars_required int check (stars_required is null or stars_required > 0),
  visible boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.rewards enable row level security;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),  -- va en el enlace y el QR
  name text not null,
  email text,
  logo text,                                   -- imagen como data URL (≤ 256 px)
  color text not null default '#5CE1B0',
  pin_hash text not null,                      -- PIN del admin del negocio
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.businesses enable row level security;

insert into public.businesses(slug, name, color, pin_hash)
select 'principal',
  coalesce((select value from public.settings where key = 'business_name'), 'Mi Negocio'),
  coalesce((select value from public.settings where key = 'brand_color'), '#5CE1B0'),
  (select value from public.settings where key = 'admin_pin_hash')
where not exists (select 1 from public.businesses);

-- El PIN del superadmin arranca igual al PIN de admin actual (cámbialo desde #/super).
insert into public.settings(key, value)
select 'super_pin_hash', value from public.settings where key = 'admin_pin_hash'
on conflict (key) do nothing;

alter table public.customers  add column if not exists business_id uuid references public.businesses(id) on delete cascade;
alter table public.promotions add column if not exists business_id uuid references public.businesses(id) on delete cascade;
alter table public.rewards    add column if not exists business_id uuid references public.businesses(id) on delete cascade;
update public.customers  set business_id = (select id from public.businesses where slug = 'principal') where business_id is null;
update public.promotions set business_id = (select id from public.businesses where slug = 'principal') where business_id is null;
update public.rewards    set business_id = (select id from public.businesses where slug = 'principal') where business_id is null;
alter table public.customers  alter column business_id set not null;
alter table public.promotions alter column business_id set not null;
alter table public.rewards    alter column business_id set not null;
create index if not exists customers_business_idx  on public.customers(business_id);
create index if not exists promotions_business_idx on public.promotions(business_id);
create index if not exists rewards_business_idx    on public.rewards(business_id);

-- Las funciones de un solo negocio dejan de existir (no filtraban por negocio).
drop function if exists public.app_register(text, text);
drop function if exists public.app_register(text, text, uuid);
drop function if exists public.app_plans();
drop function if exists public._plan_of(uuid);
drop function if exists public.admin_check(text);
drop function if exists public.admin_overview(text);
drop function if exists public.admin_customers(text);
drop function if exists public.admin_add_stars(text, text, int, text, text);
drop function if exists public.admin_redeem(text, text, uuid);
drop function if exists public.admin_assign_nfc(text, text, text);
drop function if exists public.admin_lookup(text, text);
drop function if exists public.admin_register_payment(text, text, int);
drop function if exists public.admin_confirm_day(text, text, text);
drop function if exists public.admin_use_bonus_day(text, text);
drop function if exists public.admin_delete_customer(text, text);
drop function if exists public.admin_promos(text);
drop function if exists public.admin_save_promo(text, uuid, text, text, int, boolean);
drop function if exists public.admin_save_promo(text, uuid, text, text, int, boolean, int);
drop function if exists public.admin_delete_promo(text, uuid);
drop function if exists public.admin_save_settings(text, text, text, int, text);
drop function if exists public.admin_rewards(text);
drop function if exists public.admin_save_reward(text, uuid, text, text, int, boolean);
drop function if exists public.admin_set_reward_visible(text, uuid, boolean);
drop function if exists public.admin_delete_reward(text, uuid);
drop function if exists public._require_admin(text);
drop function if exists public._pin_ok(text);

-- ───────── helpers ─────────
create or replace function public._biz_auth(p_biz text, p_pin text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare b uuid;
begin
  select id into b from businesses
   where slug = lower(trim(p_biz)) and active and pin_hash = crypt(coalesce(p_pin, ''), pin_hash);
  if b is null then raise exception 'Negocio o PIN incorrecto' using errcode = '28000'; end if;
  return b;
end $$;

create or replace function public._require_super(p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from settings where key = 'super_pin_hash'
                 and value = crypt(coalesce(p_pin, ''), value)) then
    raise exception 'PIN incorrecto' using errcode = '28000';
  end if;
end $$;

create or replace function public._cust(p_b uuid, p_code text) returns public.customers
language plpgsql security definer set search_path = public as $$
declare v customers;
begin
  select * into v from customers where business_id = p_b
     and (code = upper(trim(p_code)) or nfc_uid = upper(trim(p_code)) or id::text = trim(p_code));
  if not found then raise exception 'Tarjeta no encontrada en este negocio'; end if;
  return v;
end $$;

create or replace function public._plan_of(p_b uuid, p_plan uuid) returns public.promotions
language plpgsql security definer set search_path = public as $$
declare pr promotions;
begin
  select * into pr from promotions where id = p_plan and business_id = p_b and active;
  if not found then
    select * into pr from promotions where business_id = p_b and active order by stars_required limit 1;
  end if;
  return pr;
end $$;

-- ───────── cliente ─────────
create or replace function public.app_business(p_slug text) returns json
language sql security definer set search_path = public as $$
  select json_build_object('slug', b.slug, 'name', b.name, 'logo', b.logo, 'color', b.color,
    'plans', coalesce((select json_agg(p) from (
        select id, title, description, stars_required, reward_days from promotions
        where business_id = b.id and active order by stars_required) p), '[]'::json))
  from businesses b where b.slug = lower(trim(p_slug)) and b.active;
$$;

create or replace function public.app_register(p_biz text, p_name text, p_phone text default null, p_plan uuid default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare b businesses; v customers; pr promotions;
begin
  select * into b from businesses where slug = lower(trim(p_biz)) and active;
  if not found then raise exception 'Este negocio no está disponible'; end if;
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'Escribe tu nombre'; end if;
  pr := _plan_of(b.id, p_plan);
  insert into customers(business_id, name, phone, code, plan_id)
  values (b.id, trim(p_name), nullif(trim(p_phone),''), upper(substr(encode(gen_random_bytes(6),'hex'),1,8)), pr.id)
  returning * into v;
  return json_build_object('token', v.token, 'code', v.code, 'biz', b.slug);
end $$;

create or replace function public.app_get_card(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v customers; b businesses; pr promotions; nx promotions;
begin
  select * into v from customers where token = p_token;
  if not found then return null; end if;
  select * into b from businesses where id = v.business_id;
  pr := _plan_of(v.business_id, v.plan_id);
  select * into nx from promotions where business_id = v.business_id and active
     and stars_required > pr.stars_required order by stars_required limit 1;
  return json_build_object(
    'name', v.name, 'code', v.code, 'stars', v.stars, 'bonus_days', v.bonus_days,
    'since', v.created_at,
    'goal', coalesce(pr.stars_required, 10),
    'plan', case when pr.id is null then null else
        json_build_object('id', pr.id, 'title', pr.title, 'days', pr.stars_required, 'reward_days', pr.reward_days) end,
    'can_upgrade', (pr.id is not null and v.stars >= pr.stars_required and nx.id is not null),
    'next_plan', case when nx.id is null then null else
        json_build_object('id', nx.id, 'title', nx.title, 'days', nx.stars_required, 'reward_days', nx.reward_days) end,
    'biz', b.slug,
    'business', b.name,
    'color', b.color,
    'visits', coalesce((select json_agg(x) from (
        select created_at as at, delta, kind from visits
        where customer_id = v.id order by created_at desc limit 12) x), '[]'::json),
    'promos', coalesce((select json_agg(p) from (
        select id, title, description, stars_required, reward_days from promotions
        where business_id = v.business_id and active order by stars_required) p), '[]'::json),
    'rewards', coalesce((select json_agg(r) from (
        select id, title, description, stars_required from rewards
        where business_id = v.business_id and visible order by stars_required nulls last, created_at) r), '[]'::json)
  );
end $$;

-- Resumen de varias tarjetas guardadas en el mismo teléfono («Mis tarjetas»).
create or replace function public.app_cards(p_tokens uuid[]) returns json
language sql security definer set search_path = public as $$
  select coalesce(json_agg(c), '[]'::json) from (
    select v.token, v.name, v.stars, v.bonus_days, b.slug as biz, b.name as business, b.color, b.logo,
      coalesce((public._plan_of(v.business_id, v.plan_id)).stars_required, 10) as goal
    from customers v join businesses b on b.id = v.business_id
    where v.token = any(p_tokens[1:20]) order by b.name) c;
$$;

create or replace function public.app_choose_plan(p_token uuid, p_plan uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v customers; pr promotions;
begin
  select * into v from customers where token = p_token;
  if not found then raise exception 'Tarjeta no encontrada'; end if;
  select * into pr from promotions where id = p_plan and business_id = v.business_id and active;
  if not found then raise exception 'Plan no disponible'; end if;
  if pr.stars_required <= v.stars then raise exception 'Ese plan ya está completo'; end if;
  update customers set plan_id = pr.id where id = v.id;
  return json_build_object('plan', pr.title, 'days', pr.stars_required);
end $$;

-- ───────── admin del negocio (p_biz = enlace del negocio) ─────────
create or replace function public.admin_check(p_biz text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare b businesses;
begin
  select * into b from businesses where id = _biz_auth(p_biz, p_pin);
  return json_build_object('slug', b.slug, 'name', b.name, 'logo', b.logo, 'color', b.color);
end $$;

create or replace function public.admin_overview(p_biz text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare b uuid := _biz_auth(p_biz, p_pin);
begin
  return json_build_object(
    'customers', (select count(*) from customers where business_id = b),
    'stars_total', (select coalesce(sum(v.delta),0) from visits v join customers c on c.id = v.customer_id
                    where c.business_id = b and v.delta > 0),
    'redeemed', (select count(*) from visits v join customers c on c.id = v.customer_id
                 where c.business_id = b and v.kind in ('redeem','bonus')),
    'today', (select count(*) from visits v join customers c on c.id = v.customer_id
              where c.business_id = b and v.delta > 0 and v.created_at >= date_trunc('day', now())),
    'series', (select coalesce(json_agg(s order by s.day), '[]'::json) from (
        select d::date as day,
          (select count(*) from visits v join customers c on c.id = v.customer_id
           where c.business_id = b and v.delta > 0 and v.created_at::date = d::date) as n
        from generate_series(current_date - 13, current_date, interval '1 day') d) s),
    'recent', (select coalesce(json_agg(r), '[]'::json) from (
        select c.name, v.delta, v.kind, v.created_at as at
        from visits v join customers c on c.id = v.customer_id
        where c.business_id = b order by v.created_at desc limit 8) r),
    'business', (select name from businesses where id = b),
    'color', (select color from businesses where id = b)
  );
end $$;

create or replace function public.admin_customers(p_biz text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare b uuid := _biz_auth(p_biz, p_pin);
begin
  return coalesce((select json_agg(c) from (
    select id, code, name, phone, stars, bonus_days, created_at, nfc_uid,
      (select title from promotions p where p.id = customers.plan_id) as plan_title,
      (select max(created_at) from visits v where v.customer_id = customers.id) as last_visit
    from customers where business_id = b order by stars desc, created_at desc) c), '[]'::json);
end $$;

create or replace function public.admin_add_stars(p_biz text, p_pin text, p_code text, p_delta int default 1,
                                                 p_kind text default 'manual', p_note text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v customers := _cust(_biz_auth(p_biz, p_pin), p_code);
begin
  if v.stars + p_delta < 0 then raise exception 'El cliente no tiene tantas estrellas'; end if;
  update customers set stars = stars + p_delta where id = v.id returning * into v;
  insert into visits(customer_id, delta, kind, note) values (v.id, p_delta, p_kind, p_note);
  return json_build_object('name', v.name, 'stars', v.stars, 'code', v.code, 'delta', p_delta);
end $$;

create or replace function public.admin_assign_nfc(p_biz text, p_pin text, p_code text, p_uid text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v customers := _cust(_biz_auth(p_biz, p_pin), p_code); u text := nullif(upper(trim(p_uid)), '');
begin
  if u is not null and exists (select 1 from customers where nfc_uid = u and id <> v.id) then
    raise exception 'Esa etiqueta ya está asignada a otro cliente';
  end if;
  update customers set nfc_uid = u where id = v.id;
  return json_build_object('name', v.name, 'nfc_uid', u);
end $$;

create or replace function public.admin_lookup(p_biz text, p_pin text, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v customers := _cust(_biz_auth(p_biz, p_pin), p_code);
begin
  return json_build_object('name', v.name, 'code', v.code, 'stars', v.stars, 'bonus_days', v.bonus_days);
end $$;

create or replace function public.admin_confirm_day(p_biz text, p_pin text, p_code text, p_kind text default 'scan')
returns json language plpgsql security definer set search_path = public, extensions as $$
declare b uuid := _biz_auth(p_biz, p_pin); v customers; pr promotions; last_at timestamptz; n int; gift int := 0; cg int;
begin
  v := _cust(b, p_code);
  select max(created_at) into last_at from visits where customer_id = v.id and kind in ('scan','nfc','day');
  if last_at is not null and last_at > now() - interval '12 hours' then
    raise exception 'El día de % ya fue confirmado hoy', v.name;
  end if;
  pr := _plan_of(b, v.plan_id);
  if pr.id is null then raise exception 'El negocio no tiene planes activos'; end if;
  if v.stars >= pr.stars_required then n := 1; cg := 0; else n := v.stars + 1; cg := v.cycle_gift; end if;
  if n = pr.stars_required then gift := greatest(pr.reward_days - cg, 0); end if;
  update customers set stars = n, bonus_days = bonus_days + gift, cycle_gift = cg + gift, plan_id = pr.id
   where id = v.id returning * into v;
  insert into visits(customer_id, delta, kind, note)
  values (v.id, 1, case when p_kind = 'nfc' then 'nfc' else 'scan' end,
          'Día ' || n || ' pagado' || case when gift > 0 then ' · +' || gift || ' de regalo' else '' end);
  return json_build_object('name', v.name, 'code', v.code, 'stars', v.stars, 'bonus_days', v.bonus_days,
                           'day', n, 'target', pr.stars_required, 'gift', gift, 'completed', n = pr.stars_required);
end $$;

create or replace function public.admin_use_bonus_day(p_biz text, p_pin text, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v customers := _cust(_biz_auth(p_biz, p_pin), p_code);
begin
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

create or replace function public.admin_delete_customer(p_biz text, p_pin text, p_code text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v customers := _cust(_biz_auth(p_biz, p_pin), p_code);
begin
  delete from customers where id = v.id;
end $$;

create or replace function public.admin_promos(p_biz text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare b uuid := _biz_auth(p_biz, p_pin);
begin
  return coalesce((select json_agg(p) from (
    select * from promotions where business_id = b order by stars_required, created_at) p), '[]'::json);
end $$;

create or replace function public.admin_save_promo(p_biz text, p_pin text, p_id uuid, p_title text, p_desc text,
                                                  p_stars int, p_active boolean, p_reward int default 1)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare b uuid := _biz_auth(p_biz, p_pin);
begin
  if p_reward < 0 then raise exception 'Los días de regalo no pueden ser negativos'; end if;
  if p_id is null then
    insert into promotions(business_id, title, description, stars_required, active, reward_days)
    values (b, p_title, p_desc, p_stars, p_active, p_reward);
  else
    update promotions set title = p_title, description = p_desc, stars_required = p_stars,
      active = p_active, reward_days = p_reward where id = p_id and business_id = b;
  end if;
end $$;

create or replace function public.admin_delete_promo(p_biz text, p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from promotions where id = p_id and business_id = _biz_auth(p_biz, p_pin);
end $$;

create or replace function public.admin_rewards(p_biz text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare b uuid := _biz_auth(p_biz, p_pin);
begin
  return coalesce((select json_agg(r) from (
    select * from rewards where business_id = b order by stars_required nulls last, created_at) r), '[]'::json);
end $$;

create or replace function public.admin_save_reward(p_biz text, p_pin text, p_id uuid, p_title text, p_desc text,
                                                   p_stars int, p_visible boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare b uuid := _biz_auth(p_biz, p_pin);
begin
  if length(trim(coalesce(p_title,''))) < 2 then raise exception 'Escribe el nombre del premio'; end if;
  if p_id is null then
    insert into rewards(business_id, title, description, stars_required, visible)
    values (b, trim(p_title), nullif(trim(p_desc),''), p_stars, coalesce(p_visible, false));
  else
    update rewards set title = trim(p_title), description = nullif(trim(p_desc),''),
      stars_required = p_stars, visible = coalesce(p_visible, false) where id = p_id and business_id = b;
  end if;
end $$;

create or replace function public.admin_set_reward_visible(p_biz text, p_pin text, p_id uuid, p_visible boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  update rewards set visible = p_visible where id = p_id and business_id = _biz_auth(p_biz, p_pin);
end $$;

create or replace function public.admin_delete_reward(p_biz text, p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from rewards where id = p_id and business_id = _biz_auth(p_biz, p_pin);
end $$;

-- El admin del negocio puede cambiar el color de su tarjeta y su PIN (nombre y logo los define el superadmin).
create or replace function public.admin_save_settings(p_biz text, p_pin text, p_color text, p_new_pin text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare b uuid := _biz_auth(p_biz, p_pin);
begin
  if coalesce(p_color, '') !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Color no válido'; end if;
  update businesses set color = p_color where id = b;
  if p_new_pin is not null and length(p_new_pin) >= 4 then
    update businesses set pin_hash = crypt(p_new_pin, gen_salt('bf')) where id = b;
  end if;
end $$;

-- ───────── superadmin ─────────
create or replace function public.super_check(p_pin text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_super(p_pin);
  return true;
end $$;

create or replace function public.super_businesses(p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_super(p_pin);
  return coalesce((select json_agg(x) from (
    select b.id, b.slug, b.name, b.email, b.logo, b.color, b.active, b.created_at,
      (select count(*) from customers c where c.business_id = b.id) as customers
    from businesses b order by b.created_at desc) x), '[]'::json);
end $$;

create or replace function public.super_save_business(p_pin text, p_id uuid, p_slug text, p_name text, p_email text,
                                                     p_logo text, p_color text, p_admin_pin text, p_active boolean)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare b businesses; s text := lower(trim(p_slug));
begin
  perform _require_super(p_pin);
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'Escribe el nombre del negocio'; end if;
  if s !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'El enlace solo puede tener letras, números y guiones'; end if;
  if coalesce(p_color, '') !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Color no válido'; end if;
  if length(coalesce(p_logo, '')) > 400000 then raise exception 'El logo es demasiado grande'; end if;
  if exists (select 1 from businesses where slug = s and id is distinct from p_id) then
    raise exception 'Ya existe un negocio con el enlace «%»', s;
  end if;
  if p_id is null then
    if length(coalesce(p_admin_pin, '')) < 4 then raise exception 'El PIN del admin debe tener al menos 4 dígitos'; end if;
    insert into businesses(slug, name, email, logo, color, pin_hash, active)
    values (s, trim(p_name), nullif(trim(p_email),''), p_logo, p_color, crypt(p_admin_pin, gen_salt('bf')), coalesce(p_active, true))
    returning * into b;
    -- Plan inicial para que los clientes puedan registrarse de inmediato (el admin lo puede editar).
    insert into promotions(business_id, title, description, stars_required, reward_days, active)
    values (b.id, 'Plan 10 visitas', 'Completa 10 visitas y recibe 1 de regalo.', 10, 1, true);
  else
    update businesses set slug = s, name = trim(p_name), email = nullif(trim(p_email),''), logo = p_logo,
      color = p_color, active = coalesce(p_active, true),
      pin_hash = case when length(coalesce(p_admin_pin, '')) >= 4 then crypt(p_admin_pin, gen_salt('bf')) else pin_hash end
    where id = p_id returning * into b;
    if not found then raise exception 'Negocio no encontrado'; end if;
  end if;
  return json_build_object('id', b.id, 'slug', b.slug);
end $$;

create or replace function public.super_set_pin(p_pin text, p_new_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_super(p_pin);
  if length(coalesce(p_new_pin, '')) < 6 then raise exception 'El PIN del superadmin debe tener al menos 6 dígitos'; end if;
  update settings set value = crypt(p_new_pin, gen_salt('bf')) where key = 'super_pin_hash';
end $$;

-- ───────── permisos: el anon key solo ejecuta estas funciones ─────────
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.app_business(text), public.app_register(text, text, text, uuid), public.app_get_card(uuid),
  public.app_cards(uuid[]), public.app_choose_plan(uuid, uuid),
  public.admin_check(text, text), public.admin_overview(text, text), public.admin_customers(text, text),
  public.admin_add_stars(text, text, text, int, text, text), public.admin_assign_nfc(text, text, text, text),
  public.admin_lookup(text, text, text), public.admin_confirm_day(text, text, text, text),
  public.admin_use_bonus_day(text, text, text), public.admin_delete_customer(text, text, text),
  public.admin_promos(text, text), public.admin_save_promo(text, text, uuid, text, text, int, boolean, int),
  public.admin_delete_promo(text, text, uuid), public.admin_rewards(text, text),
  public.admin_save_reward(text, text, uuid, text, text, int, boolean),
  public.admin_set_reward_visible(text, text, uuid, boolean), public.admin_delete_reward(text, text, uuid),
  public.admin_save_settings(text, text, text, text),
  public.super_check(text), public.super_businesses(text),
  public.super_save_business(text, uuid, text, text, text, text, text, text, boolean), public.super_set_pin(text, text)
to anon, authenticated;
