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
  created_at timestamptz not null default now()
);

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

insert into public.promotions(title, description, stars_required)
select 'Café gratis', 'Una bebida de la casa por tu lealtad.', 5
where not exists (select 1 from public.promotions);
insert into public.promotions(title, description, stars_required)
select 'Postre de cortesía', 'Elige cualquier postre del día.', 10
where (select count(*) from public.promotions) = 1;

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
    'name', v.name, 'code', v.code, 'stars', v.stars,
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
    select id, code, name, phone, stars, created_at,
      (select max(created_at) from visits v where v.customer_id = customers.id) as last_visit
    from customers order by stars desc, created_at desc) c), '[]'::json);
end $$;

create or replace function public.admin_add_stars(p_pin text, p_code text, p_delta int default 1,
                                                 p_kind text default 'manual', p_note text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v customers; last_at timestamptz;
begin
  perform _require_admin(p_pin);
  select * into v from customers where code = upper(trim(p_code)) or id::text = trim(p_code);
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
  public.admin_promos(text), public.admin_save_promo(text, uuid, text, text, int, boolean),
  public.admin_delete_promo(text, uuid), public.admin_save_settings(text, text, text, int, text)
to anon, authenticated;
