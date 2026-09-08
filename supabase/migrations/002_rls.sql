-- Sabji · row level security
-- This file IS the authorisation model. Hiding a button in React hides a
-- button; these policies are what actually stop a customer editing prices.

alter table public.profiles             enable row level security;
alter table public.categories           enable row level security;
alter table public.products             enable row level security;
alter table public.product_variants     enable row level security;
alter table public.addresses            enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.order_status_history enable row level security;
alter table public.settings             enable row level security;

-- SECURITY DEFINER so the lookup itself isn't blocked by profiles' own policy.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------- profiles
create policy "read own profile" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy "update own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- NOTE: this policy does NOT stop a customer writing to is_admin. RLS filters
-- rows, not columns. 007_admin_hardening.sql revokes column-level UPDATE on
-- is_admin and introduces the admin_phones allowlist; grant admin there.

-- ---------------------------------------------------------------- catalog
-- Anyone (signed in or not) can browse the active catalogue.
create policy "public reads active categories" on public.categories
  for select using (is_active or public.is_admin());
create policy "admin writes categories" on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

create policy "public reads active products" on public.products
  for select using (is_active or public.is_admin());
create policy "admin writes products" on public.products
  for all using (public.is_admin()) with check (public.is_admin());

create policy "public reads variants" on public.product_variants
  for select using (
    public.is_admin() or exists (
      select 1 from public.products p
      where p.id = product_id and p.is_active
    )
  );
create policy "admin writes variants" on public.product_variants
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- addresses
create policy "own addresses" on public.addresses
  for all using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------- orders
-- Customers read their own; admin reads everything.
create policy "read own orders" on public.orders
  for select using (user_id = auth.uid() or public.is_admin());

-- Orders are created ONLY through place_order(). No direct insert: a client
-- that could insert its own order row could also set its own total.
create policy "admin updates orders" on public.orders
  for update using (public.is_admin()) with check (public.is_admin());

create policy "read own order items" on public.order_items
  for select using (
    public.is_admin() or exists (
      select 1 from public.orders o
      where o.id = order_id and o.user_id = auth.uid()
    )
  );

create policy "read own status history" on public.order_status_history
  for select using (
    public.is_admin() or exists (
      select 1 from public.orders o
      where o.id = order_id and o.user_id = auth.uid()
    )
  );

create policy "admin writes status history" on public.order_status_history
  for insert with check (public.is_admin());

-- ---------------------------------------------------------------- settings
create policy "anyone reads settings" on public.settings for select using (true);
create policy "admin writes settings"  on public.settings
  for update using (public.is_admin()) with check (public.is_admin());
