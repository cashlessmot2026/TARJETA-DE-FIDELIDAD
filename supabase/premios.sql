-- ═════════════════════════════════════════════════════════════════════════════
-- PREMIOS EN VEZ DE PLANES: cada escaneo suma 1 estrella, las estrellas se acumulan y el cliente
-- las canjea por los premios que el admin autoriza (al canjear el conteo vuelve a 0; la tarjeta sigue activa).
-- Ejecutar después de visitas.sql. Se puede ejecutar más de una vez.
-- La tabla promotions (planes) queda guardada pero ya no se usa.
-- ═════════════════════════════════════════════════════════════════════════════

-- Meta que muestra la tarjeta: el siguiente premio visible que aún no alcanza (o el mayor, si ya los alcanzó todos).
create or replace function public._goal(p_b uuid, p_stars int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select min(stars_required) from rewards where business_id = p_b and visible and stars_required > p_stars),
    (select max(stars_required) from rewards where business_id = p_b and visible and stars_required > 0),
    10)
$$;

-- ¿Alcanza algún premio visible?
create or replace function public._can_redeem(p_b uuid, p_stars int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from rewards where business_id = p_b and visible and stars_required > 0 and stars_required <= p_stars)
$$;

-- Suma 1 estrella. p_strict = pausa de 3 min para no contar doble la misma lectura (el ajuste manual no tiene pausa).
create or replace function public._checkin(p_v public.customers, p_via text, p_strict boolean default true)
returns json language plpgsql security definer set search_path = public as $$
declare v customers := p_v; last_at timestamptz; nx rewards;
begin
  if p_strict then
    select max(created_at) into last_at from visits
     where customer_id = v.id and delta > 0 and kind in ('scan', 'nfc', 'day', 'qr', 'phone');
    if last_at is not null and last_at > now() - interval '3 minutes' then
      raise exception 'Esta estrella ya se sumó hace un momento. Podrás sumar otra en % min',
        ceil(extract(epoch from last_at + interval '3 minutes' - now()) / 60)::int;
    end if;
  end if;
  update customers set stars = stars + 1 where id = v.id returning * into v;
  insert into visits(customer_id, delta, kind, note)
  values (v.id, 1, case when p_via in ('qr', 'nfc', 'phone', 'manual') then p_via else 'scan' end, 'Estrella ' || v.stars);
  select * into nx from rewards where business_id = v.business_id and visible and stars_required > v.stars
   order by stars_required limit 1;
  return json_build_object('name', v.name, 'code', v.code, 'stars', v.stars, 'bonus_days', v.bonus_days,
    'next', case when nx.id is null then null else json_build_object('title', nx.title, 'missing', nx.stars_required - v.stars) end,
    'ready', coalesce((select json_agg(r.title order by r.stars_required) from rewards r
                       where r.business_id = v.business_id and r.visible and r.stars_required > 0
                         and r.stars_required <= v.stars), '[]'::json));
end $$;

-- ───────── cliente ─────────
create or replace function public.app_register(p_biz text, p_name text, p_phone text default null, p_plan uuid default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare b businesses; v customers; ph text := _phone(p_phone);
begin
  select * into b from businesses where slug = lower(trim(p_biz)) and active;
  if not found then raise exception 'Este negocio no está disponible'; end if;
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'Escribe tu nombre'; end if;
  if length(coalesce(ph, '')) < 7 then raise exception 'Escribe tu número de teléfono'; end if;
  if exists (select 1 from customers where business_id = b.id and _phone(phone) = ph) then
    raise exception 'Ese teléfono ya tiene una tarjeta en %. Ábrela desde tu app o pide ayuda en caja.', b.name;
  end if;
  insert into customers(business_id, name, phone, code)
  values (b.id, trim(p_name), trim(p_phone), upper(substr(encode(gen_random_bytes(6),'hex'),1,8)))
  returning * into v;
  return json_build_object('token', v.token, 'code', v.code, 'biz', b.slug);
end $$;

create or replace function public.app_get_card(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v customers; b businesses;
begin
  select * into v from customers where token = p_token;
  if not found then return null; end if;
  select * into b from businesses where id = v.business_id;
  return json_build_object(
    'name', v.name, 'code', v.code, 'stars', v.stars, 'bonus_days', v.bonus_days,
    'since', v.created_at,
    'has_phone', _phone(v.phone) is not null,
    'goal', _goal(v.business_id, v.stars),
    'can_redeem', _can_redeem(v.business_id, v.stars),
    'biz', b.slug,
    'business', b.name,
    'color', b.color,
    'visits', coalesce((select json_agg(x) from (
        select created_at as at, delta, kind from visits
        where customer_id = v.id order by created_at desc limit 12) x), '[]'::json),
    'promos', '[]'::json,
    'rewards', coalesce((select json_agg(r) from (
        select id, title, description, stars_required from rewards
        where business_id = v.business_id and visible and stars_required > 0 order by stars_required, created_at) r), '[]'::json)
  );
end $$;

create or replace function public.app_cards(p_tokens uuid[]) returns json
language sql security definer set search_path = public as $$
  select coalesce(json_agg(c), '[]'::json) from (
    select v.token, v.name, v.stars, v.bonus_days, b.slug as biz, b.name as business, b.color, b.logo,
      public._goal(v.business_id, v.stars) as goal, public._can_redeem(v.business_id, v.stars) as can_redeem
    from customers v join businesses b on b.id = v.business_id
    where v.token = any(p_tokens[1:20]) order by b.name) c;
$$;

-- ───────── admin ─────────
create or replace function public.admin_lookup(p_biz text, p_pin text, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare b uuid := _biz_auth(p_biz, p_pin); v customers := _cust(b, p_code);
begin
  return json_build_object('name', v.name, 'code', v.code, 'stars', v.stars, 'bonus_days', v.bonus_days,
    'rewards', coalesce((select json_agg(r) from (
        select id, title, stars_required from rewards
        where business_id = b and visible and stars_required > 0 order by stars_required) r), '[]'::json));
end $$;

-- Canjear un premio: el conteo de estrellas vuelve a 0 (la tarjeta sigue activa).
create or replace function public.admin_redeem_reward(p_biz text, p_pin text, p_code text, p_reward uuid)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare b uuid := _biz_auth(p_biz, p_pin); v customers := _cust(b, p_code); r rewards;
begin
  select * into r from rewards where id = p_reward and business_id = b and visible and stars_required > 0;
  if not found then raise exception 'Ese premio no está disponible'; end if;
  if v.stars < r.stars_required then
    raise exception 'A % le faltan % estrellas para «%»', v.name, r.stars_required - v.stars, r.title;
  end if;
  insert into visits(customer_id, delta, kind, note) values (v.id, -v.stars, 'redeem', r.title);
  update customers set stars = 0 where id = v.id returning * into v;
  return json_build_object('name', v.name, 'code', v.code, 'stars', v.stars, 'bonus_days', v.bonus_days, 'reward', r.title);
end $$;

create or replace function public.admin_save_reward(p_biz text, p_pin text, p_id uuid, p_title text, p_desc text,
                                                   p_stars int, p_visible boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare b uuid := _biz_auth(p_biz, p_pin);
begin
  if length(trim(coalesce(p_title,''))) < 2 then raise exception 'Escribe el nombre del premio'; end if;
  if coalesce(p_stars, 0) < 1 then raise exception 'Indica cuántas estrellas necesita el premio'; end if;
  if p_id is null then
    insert into rewards(business_id, title, description, stars_required, visible)
    values (b, trim(p_title), nullif(trim(p_desc),''), p_stars, coalesce(p_visible, false));
  else
    update rewards set title = trim(p_title), description = nullif(trim(p_desc),''),
      stars_required = p_stars, visible = coalesce(p_visible, false) where id = p_id and business_id = b;
  end if;
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
  public.admin_redeem_reward(text, text, text, uuid),
  public.admin_promos(text, text), public.admin_save_promo(text, text, uuid, text, text, int, boolean, int),
  public.admin_delete_promo(text, text, uuid), public.admin_rewards(text, text),
  public.admin_save_reward(text, text, uuid, text, text, int, boolean),
  public.admin_set_reward_visible(text, text, uuid, boolean), public.admin_delete_reward(text, text, uuid),
  public.admin_save_settings(text, text, text, text),
  public.admin_visit_code(text, text), public.admin_regen_visit_code(text, text),
  public.super_check(text), public.super_businesses(text),
  public.super_save_business(text, uuid, text, text, text, text, text, text, boolean), public.super_set_pin(text, text)
to anon, authenticated;
