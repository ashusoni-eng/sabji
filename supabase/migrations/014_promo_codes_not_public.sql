-- Sabji · stop anonymous visitors enumerating promo codes
--
-- 008 shipped:
--   create policy "anyone reads active promos" on public.promo_codes
--     for select using (is_active or public.is_admin());
--
-- so GET /rest/v1/promo_codes returned every live code and its discount to
-- anyone holding the anon key — which is in the JavaScript bundle, i.e. anyone
-- at all. A customer or a competitor could list DIWALI50 and friends without
-- ever being told about them.
--
-- Nothing needs that read. Customers validate a code through preview_promo(),
-- which is SECURITY DEFINER and therefore bypasses RLS; the only direct reader
-- is the admin Promos screen. So the table becomes admin-only, and a customer
-- can still redeem a code they were given, but cannot discover one.

drop policy if exists "anyone reads active promos" on public.promo_codes;

create policy "admin reads promos" on public.promo_codes
  for select using (public.is_admin());
