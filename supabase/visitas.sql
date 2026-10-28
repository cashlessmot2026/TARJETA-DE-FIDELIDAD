-- ═════════════════════════════════════════════════════════════════════════════
-- ESTRELLAS POR VISITA: el cliente escanea el QR de visita del negocio (o su etiqueta NFC)
-- y la estrella solo se suma si el código es el vigente del negocio.
-- Ejecutar después de multinegocio.sql. Se puede ejecutar más de una vez.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public._new_visit_code() returns text
language sql volatile set search_path = public, extensions as $$
  select upper(encode(gen_random_bytes(5), 'hex'))
$$;

alter table public.businesses add column if not exists visit_code text;
update public.businesses set visit_code = public._new_visit_code() where visit_code is null;
alter table public.businesses alter column visit_code set default public._new_visit_code();
alter table public.businesses alter column visit_code set not null;

-- Teléfono normalizado: solo los últimos 10 dígitos (+57 319… = 319…).
create or replace function public._phone(p text) returns text
language sql immutable as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10), '')
$$;

create index if not exists customers_phone_idx on public.customers(business_id, public._phone(phone));

-- Suma una estrella según el plan. Se puede sumar varias veces al día; p_strict solo evita contar doble
-- la misma lectura (pausa de 3 min). El ajuste manual del admin no tiene pausa.
create or replace function public._checkin(p_v public.customers, p_via text, p_strict boolean default true)
returns json language plpgsql security definer set search_path = public as $$
declare v customers := p_v; pr promotions; last_at timestamptz; n int; gift int := 0; cg int;
begin
  if p_strict then
    select max(created_at) into last_at from visits
     where customer_id = v.id and delta > 0 and kind in ('scan', 'nfc', 'day', 'qr', 'phone');
    if last_at is not null and last_at > now() - interval '3 minutes' then
      raise exception 'Esta estrella ya se sumó hace un momento. Podrás sumar otra en % min',
        ceil(extract(epoch from last_at + interval '3 minutes' - now()) / 60)::int;
    end if;
  end if;
  pr := _plan_of(v.business_id, v.plan_id);
  if pr.id is null then raise exception 'El negocio no tiene planes activos'; end if;
  if v.stars >= pr.stars_required then n := 1; cg := 0; else n := v.stars + 1; cg := v.cycle_gift; end if;
  if n = pr.stars_required then gift := greatest(pr.reward_days - cg, 0); end if;
  update customers set stars = n, bonus_days = bonus_days + gift, cycle_gift = cg + gift, plan_id = pr.id
   where id = v.id returning * into v;
  insert into visits(customer_id, delta, kind, note)
  values (v.id, 1, case when p_via in ('qr', 'nfc', 'phone', 'manual') then p_via else 'scan' end,
          'Día ' || n || ' pagado' || case when gift > 0 then ' · +' || gift || ' de regalo' else '' end);
  return json_build_object('name', v.name, 'code', v.code, 'stars', v.stars, 'bonus_days', v.bonus_days,
                           'day', n, 'target', pr.stars_required, 'gift', gift, 'completed', n = pr.stars_required);
end $$;

create or replace function public._visit_biz(p_biz text, p_code text) returns public.businesses
language plpgsql security definer set search_path = public as $$
declare b businesses;
begin
  select * into b from businesses where slug = lower(trim(p_biz)) and active;
  if not found or b.visit_code <> upper(trim(coalesce(p_code, ''))) then
    raise exception 'Este código de visita no es válido. Pide al negocio el código actual.';
  end if;
  return b;
end $$;

-- ───────── cliente ─────────
create or replace function public.app_checkin(p_token uuid, p_biz text, p_code text, p_via text default 'qr')
returns json language plpgsql security definer set search_path = public as $$
declare b businesses := _visit_biz(p_biz, p_code); v customers;
begin
  select * into v from customers where token = p_token and business_id = b.id;
  if not found then return null; end if;
  return _checkin(v, case when p_via = 'nfc' then 'nfc' else 'qr' end, true);
end $$;

-- Para cuando el navegador no tiene la tarjeta (iPhone con la app instalada). Nunca devuelve el token.
create or replace function public.app_checkin_phone(p_biz text, p_code text, p_phone text, p_via text default 'qr')
returns json language plpgsql security definer set search_path = public as $$
declare b businesses := _visit_biz(p_biz, p_code); v customers; ph text := _phone(p_phone);
begin
  if length(coalesce(ph, '')) < 7 then raise exception 'Escribe tu número de teléfono'; end if;
  select * into v from customers where business_id = b.id and _phone(phone) = ph order by created_at limit 1;
  if not found then return null; end if;
  return _checkin(v, 'phone', true);
end $$;

create or replace function public.app_set_phone(p_token uuid, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
declare v customers; ph text := _phone(p_phone);
begin
  if length(coalesce(ph, '')) < 7 then raise exception 'Escribe un teléfono válido'; end if;
  select * into v from customers where token = p_token;
  if not found then raise exception 'Tarjeta no encontrada'; end if;
  if exists (select 1 from customers where business_id = v.business_id and _phone(phone) = ph and id <> v.id) then
    raise exception 'Ese teléfono ya tiene una tarjeta en este negocio';
  end if;
  update customers set phone = trim(p_phone) where id = v.id;
end $$;

create or replace function public.app_register(p_biz text, p_name text, p_phone text default null, p_plan uuid default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare b businesses; v customers; pr promotions; ph text := _phone(p_phone);
begin
  select * into b from businesses where slug = lower(trim(p_biz)) and active;
  if not found then raise exception 'Este negocio no está disponible'; end if;
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'Escribe tu nombre'; end if;
  if length(coalesce(ph, '')) < 7 then raise exception 'Escribe tu número de teléfono'; end if;
  if exists (select 1 from customers where business_id = b.id and _phone(phone) = ph) then
    raise exception 'Ese teléfono ya tiene una tarjeta en %. Ábrela desde tu app o pide ayuda en caja.', b.name;
  end if;
  pr := _plan_of(b.id, p_plan);
  insert into customers(business_id, name, phone, code, plan_id)
  values (b.id, trim(p_name), trim(p_phone), upper(substr(encode(gen_random_bytes(6),'hex'),1,8)), pr.id)
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
    'has_phone', _phone(v.phone) is not null,
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

-- ───────── admin del negocio ─────────
create or replace function public.admin_visit_code(p_biz text, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  return (select visit_code from businesses where id = _biz_auth(p_biz, p_pin));
end $$;

create or replace function public.admin_regen_visit_code(p_biz text, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare c text;
begin
  update businesses set visit_code = _new_visit_code() where id = _biz_auth(p_biz, p_pin) returning visit_code into c;
  return c;
end $$;

-- Ajuste del admin: p_kind = 'manual' suma sin pausa.
create or replace function public.admin_confirm_day(p_biz text, p_pin text, p_code text, p_kind text default 'scan')
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v customers := _cust(_biz_auth(p_biz, p_pin), p_code);
begin
  return _checkin(v, case when p_kind = 'manual' then 'manual' when p_kind = 'nfc' then 'nfc' else 'scan' end,
                  p_kind <> 'manual');
end $$;

-- ───────── superadmin ─────────
create or replace function public.super_businesses(p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _require_super(p_pin);
  return coalesce((select json_agg(x) from (
    select b.id, b.slug, b.name, b.email, b.logo, b.color, b.active, b.created_at, b.visit_code,
      (select count(*) from customers c where c.business_id = b.id) as customers
    from businesses b order by b.created_at desc) x), '[]'::json);
end $$;

-- ───────── permisos: el anon key solo ejecuta estas funciones ─────────
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.app_business(text), public.app_register(text, text, text, uuid), public.app_get_card(uuid),
  public.app_cards(uuid[]), public.app_choose_plan(uuid, uuid),
  public.app_checkin(uuid, text, text, text), public.app_checkin_phone(text, text, text, text),
  public.app_set_phone(uuid, text),
  public.admin_check(text, text), public.admin_overview(text, text), public.admin_customers(text, text),
  public.admin_add_stars(text, text, text, int, text, text), public.admin_assign_nfc(text, text, text, text),
  public.admin_lookup(text, text, text), public.admin_confirm_day(text, text, text, text),
  public.admin_use_bonus_day(text, text, text), public.admin_delete_customer(text, text, text),
  public.admin_promos(text, text), public.admin_save_promo(text, text, uuid, text, text, int, boolean, int),
  public.admin_delete_promo(text, text, uuid), public.admin_rewards(text, text),
  public.admin_save_reward(text, text, uuid, text, text, int, boolean),
  public.admin_set_reward_visible(text, text, uuid, boolean), public.admin_delete_reward(text, text, uuid),
  public.admin_save_settings(text, text, text, text),
  public.admin_visit_code(text, text), public.admin_regen_visit_code(text, text),
  public.super_check(text), public.super_businesses(text),
  public.super_save_business(text, uuid, text, text, text, text, text, text, boolean), public.super_set_pin(text, text)
to anon, authenticated;
