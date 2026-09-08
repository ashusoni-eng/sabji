-- Sabji · staff roles, MRP, promo codes, store branding, support details

-- ================================================================ 1. ROLES
-- Replaces the boolean is_admin with a role, so a delivery rider is a
-- first-class kind of account rather than "not an admin".
do $$ begin
  create type public.user_role as enum ('customer', 'admin', 'delivery');
exception when duplicate_object then null; end $$;

alter table public.profiles
  add column if not exists role public.user_role not null default 'customer';

-- Generalises admin_phones: a number is granted a role, and keeps it across
-- new sign-ins, new devices and cleared storage.
create table if not exists public.staff_phones (
  phone      text primary key,                       -- E.164, e.g. +919876543210
  role       public.user_role not null default 'delivery',
  name       text not null default '',
  note       text not null default '',
  created_at timestamptz not null default now()
);
alter table public.staff_phones enable row level security;

-- Carry over anyone already promoted through admin_phones.
do $$ begin
  if to_regclass('public.admin_phones') is not null then
    insert into public.staff_phones (phone, role, note)
    select phone, 'admin'::public.user_role, note from public.admin_phones
    on conflict (phone) do update set role = 'admin';
  end if;
end $$;

update public.profiles set role = 'admin' where is_admin and role = 'customer';

create or replace function public.sync_role_from_allowlist()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_role public.user_role;
begin
  select s.role into v_role from public.staff_phones s where s.phone = new.phone;

  if v_role is not null then
    new.role := v_role;
  elsif auth.uid() is not null then
    -- An API caller can never raise their own privileges.
    new.role := coalesce(old.role, 'customer');
  end if;

  new.is_admin := (new.role = 'admin');   -- kept in step for older reads
  return new;
end;
$$;

drop trigger if exists profiles_sync_admin on public.profiles;
drop trigger if exists profiles_sync_role  on public.profiles;
create trigger profiles_sync_role
  before insert or update on public.profiles
  for each row execute function public.sync_role_from_allowlist();

-- is_admin stays revoked at column level; role must be too.
revoke update on public.profiles from authenticated, anon;
grant  update (full_name, phone) on public.profiles to authenticated;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.role = 'admin'
            or exists (select 1 from public.staff_phones s
                        where s.phone = p.phone and s.role = 'admin'))
  );
$$;

create or replace function public.is_delivery()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.role = 'delivery'
            or exists (select 1 from public.staff_phones s
                        where s.phone = p.phone and s.role = 'delivery'))
  );
$$;

-- Admins need to list riders to assign deliveries.
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (id = auth.uid() or public.is_admin());


-- ================================================================ 2. MRP
-- Shown struck through next to the selling price. Null means "no MRP", and the
-- UI then shows the price alone rather than a fake discount.
alter table public.product_variants
  add column if not exists mrp_paise int;

do $$ begin
  alter table public.product_variants
    add constraint mrp_not_below_price check (mrp_paise is null or mrp_paise >= price_paise);
exception when duplicate_object then null; end $$;


-- ================================================================ 3. PROMOS
create table if not exists public.promo_codes (
  id               uuid primary key default uuid_generate_v4(),
  code             text not null unique,
  kind             text not null default 'percent' check (kind in ('percent', 'flat')),
  value            int  not null check (value > 0),   -- percent (1-100) or paise
  max_discount_paise int,                             -- caps a percent discount
  min_order_paise  int not null default 0,
  valid_from       timestamptz,
  valid_to         timestamptz,
  max_redemptions  int,                               -- null = unlimited
  once_per_user    boolean not null default true,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);
alter table public.promo_codes enable row level security;

create policy "anyone reads active promos" on public.promo_codes
  for select using (is_active or public.is_admin());
create policy "admin writes promos" on public.promo_codes
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.promo_redemptions (
  id             uuid primary key default uuid_generate_v4(),
  promo_id       uuid not null references public.promo_codes(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  order_id       uuid not null references public.orders(id) on delete cascade,
  discount_paise int  not null,
  redeemed_at    timestamptz not null default now()
);
alter table public.promo_redemptions enable row level security;

create index if not exists promo_redemptions_promo_idx on public.promo_redemptions(promo_id);
create index if not exists promo_redemptions_user_idx  on public.promo_redemptions(promo_id, user_id);

create policy "read own redemptions" on public.promo_redemptions
  for select using (user_id = auth.uid() or public.is_admin());

alter table public.orders
  add column if not exists promo_code      text,
  add column if not exists promo_id        uuid references public.promo_codes(id) on delete set null,
  add column if not exists discount_paise  int not null default 0;

alter table public.orders
  add column if not exists delivery_person_id uuid references auth.users(id) on delete set null;

create index if not exists orders_delivery_idx on public.orders(delivery_person_id, status);


-- ================================================================ 4. BRANDING
alter table public.settings
  add column if not exists logo_path     text,
  add column if not exists banner_path   text,
  add column if not exists banner_text   text not null default '',
  add column if not exists support_phone text not null default '',
  add column if not exists support_email text not null default '';
