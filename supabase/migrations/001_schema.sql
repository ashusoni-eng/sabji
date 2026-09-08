-- Sabji · core schema
-- Money is stored in PAISE as integers everywhere. Never use float for money.

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------- profiles
-- Mirrors auth.users. is_admin is the ONLY thing that grants admin power,
-- and it is checked server-side in RLS policies (see 002_rls.sql).
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  phone       text,
  full_name   text,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Auto-create a profile row whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Phone-OTP sign-in fills auth.users.phone; the dev email shim passes the
  -- number in user metadata instead. Handle both.
  insert into public.profiles (id, phone, full_name)
  values (
    new.id,
    coalesce(new.phone, new.raw_user_meta_data->>'phone'),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- catalog
create table public.categories (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  slug        text not null unique,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.products (
  id           uuid primary key default uuid_generate_v4(),
  category_id  uuid references public.categories(id) on delete set null,
  name         text not null,
  description  text not null default '',
  image_path   text,             -- path inside the 'product-images' storage bucket
  image_url    text,             -- fallback for seeded/legacy images; image_path wins when set
  badge        text,             -- e.g. 'Fresh', "Season's Best" — optional pill on the card
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index products_category_idx on public.products(category_id);
create index products_active_idx   on public.products(is_active);

-- Variants exist because sabji pricing is genuinely multi-priced:
-- "Hybrid ₹30/kg" vs "Desi ₹50 for 2kg", "₹30/kg" vs "5kg for ₹130".
-- Every product has at least one variant; simple products just have one.
create table public.product_variants (
  id           uuid primary key default uuid_generate_v4(),
  product_id   uuid not null references public.products(id) on delete cascade,
  label        text not null default 'Default',   -- 'Hybrid', 'Desi', 'Orange', 'Red'
  unit         text not null default '1 kg',      -- '1 kg', '12 pc', '5 kg', '1 pkt'
  price_paise  int  not null check (price_paise >= 0),
  in_stock     boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

create index variants_product_idx on public.product_variants(product_id);

-- Full-text search over the catalog.
create index products_search_idx on public.products
  using gin (to_tsvector('simple', name || ' ' || description));

-- ---------------------------------------------------------------- addresses
create table public.addresses (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  label       text not null default 'Home',
  full_name   text not null,
  phone       text not null,
  line1       text not null,
  line2       text not null default '',
  landmark    text not null default '',
  pincode     text not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index addresses_user_idx on public.addresses(user_id);

-- ---------------------------------------------------------------- orders
create type public.order_status as enum (
  'placed', 'confirmed', 'packed', 'out_for_delivery', 'delivered', 'cancelled'
);

create sequence public.order_no_seq start 1001;

create table public.orders (
  id                 uuid primary key default uuid_generate_v4(),
  order_no           text not null unique default ('SBJ-' || nextval('public.order_no_seq')::text),
  user_id            uuid not null references auth.users(id) on delete restrict,
  status             public.order_status not null default 'placed',

  -- Address is SNAPSHOT, not a foreign key. If the customer later edits or
  -- deletes the address, the order must still say where it actually went.
  ship_full_name     text not null,
  ship_phone         text not null,
  ship_line1         text not null,
  ship_line2         text not null default '',
  ship_landmark      text not null default '',
  ship_pincode       text not null,

  delivery_slot      text not null,
  notes              text not null default '',

  subtotal_paise     int not null check (subtotal_paise >= 0),
  delivery_fee_paise int not null default 0 check (delivery_fee_paise >= 0),
  total_paise        int not null check (total_paise >= 0),

  payment_method     text not null default 'cod',
  cancel_reason      text,

  -- Stops a double-tap on flaky mobile data from creating two orders.
  idempotency_key    text not null unique,

  placed_at          timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index orders_user_idx   on public.orders(user_id, placed_at desc);
create index orders_status_idx on public.orders(status, placed_at desc);

-- Order lines snapshot name, variant, unit AND price. Sabji prices move daily;
-- joining to the live catalogue would silently re-price completed orders.
create table public.order_items (
  id               uuid primary key default uuid_generate_v4(),
  order_id         uuid not null references public.orders(id) on delete cascade,
  product_id       uuid references public.products(id) on delete set null,
  variant_id       uuid references public.product_variants(id) on delete set null,
  product_name     text not null,
  variant_label    text not null,
  unit             text not null,
  image_path       text,
  image_url        text,
  unit_price_paise int not null check (unit_price_paise >= 0),
  qty              int not null check (qty > 0),
  line_total_paise int not null check (line_total_paise >= 0)
);

create index order_items_order_idx on public.order_items(order_id);

create table public.order_status_history (
  id          uuid primary key default uuid_generate_v4(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  status      public.order_status not null,
  note        text not null default '',
  changed_by  uuid references auth.users(id) on delete set null,
  changed_at  timestamptz not null default now()
);

create index status_history_order_idx on public.order_status_history(order_id, changed_at);

-- ---------------------------------------------------------------- settings
-- Single-row table so the admin can change delivery rules without a deploy.
create table public.settings (
  id                    int primary key default 1 check (id = 1),
  delivery_fee_paise    int not null default 2000,
  free_delivery_over_paise int not null default 30000,
  min_order_paise       int not null default 10000,
  delivery_slots        text[] not null default array[
                          'Today, 5–8 PM', 'Tomorrow, 7–10 AM', 'Tomorrow, 5–8 PM'],
  is_shop_open          boolean not null default true,
  closed_message        text not null default 'Shop is closed right now. Back tomorrow at 7 AM.',
  updated_at            timestamptz not null default now()
);

insert into public.settings (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------- updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();
