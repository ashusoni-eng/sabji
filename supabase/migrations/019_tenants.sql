-- Sabji · multi-tenant
--
-- One database, many shops. Every shop-owned row carries a tenant_id and RLS
-- filters on it, so a shop admin can only ever see their own catalogue, orders,
-- staff, promos and settings. Customers are NOT tenant-scoped — one person can
-- buy from several shops — so addresses and profiles stay global, and an order
-- records which tenant it was placed with.
--
-- A superadmin (global allowlist, like staff_phones but not per-shop) creates
-- tenants and assigns their first admin. The shop NAME is set by the superadmin
-- and is read-only to the shop; everything else about the shop is theirs.

-- ================================================================ tenants
create table if not exists public.tenants (
  id         uuid primary key default uuid_generate_v4(),
  shop_id    text not null unique,          -- SGS47400101: initials + pincode + seq
  name       text not null,
  pincode    text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
alter table public.tenants enable row level security;

-- The human-readable shop id. Initials of the name (letters only, up to four),
-- the pincode, then a two-digit sequence so two shops with the same initials
-- in the same pincode get 01 and 02.
create or replace function public.generate_shop_id(p_name text, p_pincode text)
returns text
language plpgsql stable set search_path = public
as $$
declare
  v_initials text := '';
  v_word     text;
  v_pin      text := regexp_replace(coalesce(p_pincode, ''), '\D', '', 'g');
  v_prefix   text;
  v_seq      int;
begin
  for v_word in select regexp_split_to_table(upper(coalesce(p_name, '')), '\s+') loop
    v_word := regexp_replace(v_word, '[^A-Z]', '', 'g');
    if v_word <> '' then v_initials := v_initials || left(v_word, 1); end if;
    exit when length(v_initials) >= 4;
  end loop;
  -- A one-word name still needs two letters to look like an id.
  if length(v_initials) < 2 then
    v_initials := rpad(left(regexp_replace(upper(p_name), '[^A-Z]', '', 'g') || 'XX', 2), 2, 'X');
  end if;
  if length(v_pin) <> 6 then
    raise exception 'Pincode must be 6 digits.' using errcode = 'P0020';
  end if;

  v_prefix := v_initials || v_pin;
  select coalesce(max(substr(shop_id, length(v_prefix) + 1)::int), 0) + 1
    into v_seq
    from public.tenants
   where shop_id ~ ('^' || v_prefix || '\d{2}$');
  return v_prefix || lpad(v_seq::text, 2, '0');
end;
$$;

-- ================================================================ superadmins
create table if not exists public.superadmins (
  phone      text primary key,
  name       text not null default '',
  created_at timestamptz not null default now()
);
alter table public.superadmins enable row level security;   -- no policies: SQL only

create or replace function public.is_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
      join public.superadmins s on s.phone = p.phone
     where p.id = auth.uid()
  );
$$;

-- ================================================================ platform
-- Settings that belong to the platform, not to any one shop.
create table if not exists public.platform (
  id                   int primary key default 1 check (id = 1),
  whatsapp_bot_number  text not null default '',      -- E.164 without +, e.g. 919876543210
  updated_at           timestamptz not null default now()
);
insert into public.platform (id) values (1) on conflict do nothing;
alter table public.platform enable row level security;
create policy "anyone reads platform" on public.platform for select using (true);

-- ================================================================ columns
alter table public.profiles     add column if not exists tenant_id uuid references public.tenants(id) on delete set null;
alter table public.staff_phones add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.categories   add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.products     add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.orders       add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.promo_codes  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.settings     add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.orders       add column if not exists channel text not null default 'web'
                                  check (channel in ('web', 'whatsapp'));

-- settings was a single row pinned to id = 1; it becomes one row per tenant.
alter table public.settings drop constraint if exists settings_id_check;
alter table public.settings alter column id set default nextval('public.order_no_seq');

-- ================================================================ backfill
-- Everything that exists today belongs to the one shop that exists today.
do $$
declare v_t uuid;
begin
  if not exists (select 1 from public.tenants) then
    insert into public.tenants (shop_id, name, pincode)
    values (public.generate_shop_id('Suvidha General Store', '474001'),
            'Suvidha General Store', '474001')
    returning id into v_t;
  else
    select id into v_t from public.tenants order by created_at limit 1;
  end if;

  update public.categories  set tenant_id = v_t where tenant_id is null;
  update public.products    set tenant_id = v_t where tenant_id is null;
  update public.orders      set tenant_id = v_t where tenant_id is null;
  update public.promo_codes set tenant_id = v_t where tenant_id is null;
  update public.settings    set tenant_id = v_t where tenant_id is null;
  update public.staff_phones set tenant_id = v_t where tenant_id is null;
  update public.profiles p set tenant_id = v_t
   where tenant_id is null
     and exists (select 1 from public.staff_phones s where s.phone = p.phone);
end $$;

alter table public.categories   alter column tenant_id set not null;
alter table public.products     alter column tenant_id set not null;
alter table public.orders       alter column tenant_id set not null;
alter table public.promo_codes  alter column tenant_id set not null;
alter table public.settings     alter column tenant_id set not null;
alter table public.staff_phones alter column tenant_id set not null;

create unique index if not exists settings_tenant_uidx    on public.settings(tenant_id);
create index        if not exists categories_tenant_idx   on public.categories(tenant_id);
create index        if not exists products_tenant_idx     on public.products(tenant_id, is_active);
create index        if not exists orders_tenant_idx       on public.orders(tenant_id, status, placed_at desc);
create index        if not exists staff_tenant_idx        on public.staff_phones(tenant_id);

-- Promo codes are unique within a shop, not across the platform.
alter table public.promo_codes drop constraint if exists promo_codes_code_key;
create unique index if not exists promo_codes_tenant_code_uidx on public.promo_codes(tenant_id, upper(code));
-- Category slugs likewise.
alter table public.categories drop constraint if exists categories_slug_key;
create unique index if not exists categories_tenant_slug_uidx on public.categories(tenant_id, slug);

-- Every new tenant gets a settings row automatically.
create or replace function public.tenant_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.settings (tenant_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists tenants_defaults on public.tenants;
create trigger tenants_defaults after insert on public.tenants
  for each row execute function public.tenant_defaults();

-- ================================================================ identity
create or replace function public.my_tenant()
returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.profiles where id = auth.uid();
$$;

-- Admin OF a particular tenant. is_admin() alone still means "is some shop's
-- admin", which is what the nav uses; policies use this one.
create or replace function public.is_admin_of(p_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() and public.my_tenant() = p_tenant;
$$;

grant execute on function public.my_tenant()        to authenticated;
grant execute on function public.is_admin_of(uuid)  to authenticated;
grant execute on function public.is_superadmin()    to authenticated;
grant execute on function public.generate_shop_id(text, text) to authenticated;

-- The role trigger now also copies the staff row's tenant onto the profile.
create or replace function public.sync_role_from_allowlist()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_role public.user_role; v_tenant uuid;
begin
  select s.role, s.tenant_id into v_role, v_tenant
    from public.staff_phones s where s.phone = new.phone;

  if auth.uid() is null then
    new.role      := coalesce(v_role, new.role, 'customer');
    new.tenant_id := coalesce(v_tenant, new.tenant_id);
  else
    new.role      := coalesce(v_role, 'customer');
    new.tenant_id := v_tenant;         -- null for customers
  end if;

  new.is_admin := (new.role = 'admin');
  return new;
end;
$$;

-- ================================================================ RLS
-- tenants: everyone can read active shops (needed to show a shop name); only
-- a superadmin writes.
create policy "read active tenants" on public.tenants
  for select using (is_active or public.is_superadmin() or id = public.my_tenant());
create policy "superadmin writes tenants" on public.tenants
  for all using (public.is_superadmin()) with check (public.is_superadmin());

create policy "superadmin writes platform" on public.platform
  for update using (public.is_superadmin()) with check (public.is_superadmin());

-- catalogue: public read of any active shop; writes only by that shop's admin
drop policy if exists "public reads active categories" on public.categories;
drop policy if exists "admin writes categories"        on public.categories;
create policy "public reads active categories" on public.categories
  for select using (is_active or public.is_admin_of(tenant_id));
create policy "admin writes categories" on public.categories
  for all using (public.is_admin_of(tenant_id)) with check (public.is_admin_of(tenant_id));

drop policy if exists "public reads active products" on public.products;
drop policy if exists "admin writes products"        on public.products;
create policy "public reads active products" on public.products
  for select using (is_active or public.is_admin_of(tenant_id));
create policy "admin writes products" on public.products
  for all using (public.is_admin_of(tenant_id)) with check (public.is_admin_of(tenant_id));

drop policy if exists "public reads variants" on public.product_variants;
drop policy if exists "admin writes variants" on public.product_variants;
create policy "public reads variants" on public.product_variants
  for select using (exists (
    select 1 from public.products p
     where p.id = product_id and (p.is_active or public.is_admin_of(p.tenant_id))));
create policy "admin writes variants" on public.product_variants
  for all using (exists (
    select 1 from public.products p where p.id = product_id and public.is_admin_of(p.tenant_id)))
  with check (exists (
    select 1 from public.products p where p.id = product_id and public.is_admin_of(p.tenant_id)));

-- settings: public read (delivery rules, banner); the shop's admin writes
drop policy if exists "anyone reads settings" on public.settings;
drop policy if exists "admin writes settings" on public.settings;
create policy "anyone reads settings" on public.settings for select using (true);
create policy "admin writes settings" on public.settings
  for update using (public.is_admin_of(tenant_id)) with check (public.is_admin_of(tenant_id));

-- promos: admin of that shop only (customers go through preview_promo)
drop policy if exists "admin reads promos"  on public.promo_codes;
drop policy if exists "admin writes promos" on public.promo_codes;
create policy "admin reads promos" on public.promo_codes
  for select using (public.is_admin_of(tenant_id));
create policy "admin writes promos" on public.promo_codes
  for all using (public.is_admin_of(tenant_id)) with check (public.is_admin_of(tenant_id));

-- orders: customer sees their own across shops; the shop's admin sees the shop's
drop policy if exists "read own orders"      on public.orders;
drop policy if exists "admin updates orders" on public.orders;
create policy "read own orders" on public.orders
  for select using (user_id in (select public.my_user_ids()) or public.is_admin_of(tenant_id));
create policy "admin updates orders" on public.orders
  for update using (public.is_admin_of(tenant_id)) with check (public.is_admin_of(tenant_id));

drop policy if exists "read own order items" on public.order_items;
create policy "read own order items" on public.order_items
  for select using (exists (
    select 1 from public.orders o
     where o.id = order_id
       and (o.user_id in (select public.my_user_ids())
            or public.is_admin_of(o.tenant_id)
            or (o.delivery_person_id in (select public.my_user_ids())
                and o.status in ('out_for_delivery', 'delivered')))));

drop policy if exists "read own status history" on public.order_status_history;
create policy "read own status history" on public.order_status_history
  for select using (exists (
    select 1 from public.orders o
     where o.id = order_id
       and (o.user_id in (select public.my_user_ids())
            or public.is_admin_of(o.tenant_id)
            or (o.delivery_person_id in (select public.my_user_ids())
                and o.status in ('out_for_delivery', 'delivered')))));

drop policy if exists "admin writes status history" on public.order_status_history;
create policy "admin writes status history" on public.order_status_history
  for insert with check (exists (
    select 1 from public.orders o where o.id = order_id and public.is_admin_of(o.tenant_id)));

drop policy if exists "read own redemptions" on public.promo_redemptions;
create policy "read own redemptions" on public.promo_redemptions
  for select using (
    user_id in (select public.my_user_ids())
    or exists (select 1 from public.promo_codes pc where pc.id = promo_id and public.is_admin_of(pc.tenant_id)));

-- profiles: admins read their own shop's staff; superadmin reads all
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (
    id = auth.uid()
    or public.is_superadmin()
    or (public.is_admin() and tenant_id = public.my_tenant()));
