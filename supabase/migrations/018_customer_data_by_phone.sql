-- Sabji · a customer's addresses, orders and promo usage follow their phone
--
-- 016 made staff and delivery key off the phone, because anonymous sign-in
-- mints a new user id every time. Customer data was left on the user id, and
-- it bit immediately: a customer saved an address in one session, signed in
-- again (new device, cleared storage), and checkout showed no addresses.
--
-- Worse, the once-per-user promo check was also by user id, so a customer
-- could redeem a single-use code again just by signing in again.
--
-- Everything a customer owns now resolves through my_user_ids() — every user
-- id sharing the caller's phone. New rows are still written under the current
-- session's id; reads and updates see the whole set.

-- ---------------------------------------------------------------- addresses
drop policy if exists "own addresses" on public.addresses;
create policy "own addresses" on public.addresses
  for all
  using (user_id in (select public.my_user_ids()) or public.is_admin())
  with check (user_id in (select public.my_user_ids()));

-- ---------------------------------------------------------------- orders
drop policy if exists "read own orders" on public.orders;
create policy "read own orders" on public.orders
  for select using (user_id in (select public.my_user_ids()) or public.is_admin());

drop policy if exists "read own order items" on public.order_items;
create policy "read own order items" on public.order_items
  for select using (
    public.is_admin() or exists (
      select 1 from public.orders o
       where o.id = order_id
         and (o.user_id in (select public.my_user_ids())
              or (o.delivery_person_id in (select public.my_user_ids())
                  and o.status in ('out_for_delivery', 'delivered')))
    )
  );

drop policy if exists "read own status history" on public.order_status_history;
create policy "read own status history" on public.order_status_history
  for select using (
    public.is_admin() or exists (
      select 1 from public.orders o
       where o.id = order_id
         and (o.user_id in (select public.my_user_ids())
              or (o.delivery_person_id in (select public.my_user_ids())
                  and o.status in ('out_for_delivery', 'delivered')))
    )
  );

drop policy if exists "read own redemptions" on public.promo_redemptions;
create policy "read own redemptions" on public.promo_redemptions
  for select using (user_id in (select public.my_user_ids()) or public.is_admin());

-- ---------------------------------------------------------------- cancel
create or replace function public.cancel_my_order(p_order_id uuid, p_reason text default '')
returns void
language plpgsql security definer set search_path = public
as $$
declare v_o public.orders%rowtype;
begin
  select * into v_o from public.orders
   where id = p_order_id and user_id in (select public.my_user_ids());
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  if v_o.status not in ('placed','confirmed') then
    raise exception 'This order is already being packed and can no longer be cancelled. Please call the shop.'
      using errcode = 'P0009';
  end if;

  update public.orders
     set status = 'cancelled', cancel_reason = nullif(p_reason,'')
   where id = p_order_id;

  insert into public.order_status_history (order_id, status, note, changed_by)
  values (p_order_id, 'cancelled', coalesce(p_reason,'Cancelled by customer'), auth.uid());
end;
$$;

-- ---------------------------------------------------------------- promos
-- once_per_user now means once per PHONE. Signing in again does not reset it.
create or replace function public.check_promo(
  p_code     text,
  p_user     uuid,
  p_subtotal int
)
returns table (promo_id uuid, code text, discount_paise int, reason text)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_p     public.promo_codes%rowtype;
  v_used  int;
  v_all   int;
  v_disc  int;
  v_phone text;
begin
  select * into v_p from public.promo_codes pc
   where upper(pc.code) = upper(trim(p_code));

  if not found then
    return query select null::uuid, null::text, 0, 'That code does not exist.'; return;
  end if;
  if not v_p.is_active then
    return query select null::uuid, v_p.code, 0, 'That code is no longer active.'; return;
  end if;
  if v_p.valid_from is not null and now() < v_p.valid_from then
    return query select null::uuid, v_p.code, 0, 'That code is not valid yet.'; return;
  end if;
  if v_p.valid_to is not null and now() > v_p.valid_to then
    return query select null::uuid, v_p.code, 0, 'That code has expired.'; return;
  end if;
  if p_subtotal < v_p.min_order_paise then
    return query select null::uuid, v_p.code, 0,
      format('Spend at least ₹%s to use this code.', v_p.min_order_paise / 100); return;
  end if;

  if v_p.max_redemptions is not null then
    select count(*) into v_all from public.promo_redemptions r where r.promo_id = v_p.id;
    if v_all >= v_p.max_redemptions then
      return query select null::uuid, v_p.code, 0, 'That code has been fully claimed.'; return;
    end if;
  end if;

  if v_p.once_per_user then
    select phone into v_phone from public.profiles where id = p_user;
    select count(*) into v_used
      from public.promo_redemptions r
      join public.profiles rp on rp.id = r.user_id
     where r.promo_id = v_p.id
       and (r.user_id = p_user
            or (v_phone is not null and rp.phone = v_phone));
    if v_used > 0 then
      return query select null::uuid, v_p.code, 0, 'You have already used this code.'; return;
    end if;
  end if;

  v_disc := case v_p.kind
              when 'percent' then (p_subtotal * v_p.value) / 100
              else v_p.value
            end;
  if v_p.max_discount_paise is not null then
    v_disc := least(v_disc, v_p.max_discount_paise);
  end if;
  v_disc := least(v_disc, p_subtotal);

  return query select v_p.id, v_p.code, v_disc, null::text;
end;
$$;

-- ---------------------------------------------------------------- place order
-- The address may belong to any of the caller's sessions, not just this one.
-- Only that one line changes; the rest is 017 verbatim.
create or replace function public.place_order(
  p_items             jsonb,
  p_address_id        uuid,
  p_delivery_slot     text,
  p_notes             text,
  p_idempotency_key   text,
  p_promo_code        text default null,
  p_payment_method    text default 'cod',
  p_paid_amount_paise int  default null,
  p_paid_reference    text default null
)
returns table (order_id uuid, order_no text, total_paise int)
language plpgsql security definer set search_path = public
as $$
declare
  v_user        uuid := auth.uid();
  v_addr        public.addresses%rowtype;
  v_settings    public.settings%rowtype;
  v_order       public.orders%rowtype;
  v_existing    public.orders%rowtype;
  v_item        jsonb;
  v_variant_id  uuid;
  v_qty         int;
  v_v           record;
  v_promo       record;
  v_subtotal    int  := 0;
  v_discount    int  := 0;
  v_promo_id    uuid := null;
  v_promo_code  text := null;
  v_fee         int  := 0;
  v_method      text := coalesce(nullif(trim(p_payment_method), ''), 'cod');
  v_pay_status  text := 'pending';
  v_paid_amount int  := null;
  v_paid_at     timestamptz := null;
begin
  if v_user is null then
    raise exception 'You must be signed in to place an order.' using errcode = '42501';
  end if;

  select * into v_existing from public.orders
    where idempotency_key = p_idempotency_key and user_id = v_user;
  if found then
    return query select v_existing.id, v_existing.order_no, v_existing.total_paise;
    return;
  end if;

  select * into v_settings from public.settings where id = 1;
  if not v_settings.is_shop_open then
    raise exception '%', v_settings.closed_message using errcode = 'P0001';
  end if;

  if v_method not in ('cod', 'online') then
    raise exception 'Unknown payment method.' using errcode = 'P0016';
  end if;
  if v_method = 'online'
     and not (v_settings.online_payment_enabled and v_settings.payment_qr_path is not null) then
    raise exception 'Online payment is not available right now. Please choose cash on delivery.'
      using errcode = 'P0017';
  end if;

  select * into v_addr from public.addresses
    where id = p_address_id
      and user_id in (select public.my_user_ids());
  if not found then
    raise exception 'Delivery address not found.' using errcode = 'P0002';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.' using errcode = 'P0003';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_variant_id := (v_item->>'variant_id')::uuid;
    v_qty        := (v_item->>'qty')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity.' using errcode = 'P0004';
    end if;

    select pv.id, pv.price_paise, pv.in_stock, p.name as product_name, p.is_active
      into v_v
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
     where pv.id = v_variant_id;

    if not found then
      raise exception 'An item in your cart is no longer available.' using errcode = 'P0005';
    end if;
    if not v_v.is_active or not v_v.in_stock then
      raise exception '% is out of stock.', v_v.product_name using errcode = 'P0006';
    end if;

    v_subtotal := v_subtotal + (v_v.price_paise * v_qty);
  end loop;

  if v_subtotal < v_settings.min_order_paise then
    raise exception 'Minimum order is ₹%.', (v_settings.min_order_paise / 100)
      using errcode = 'P0007';
  end if;

  if p_promo_code is not null and length(trim(p_promo_code)) > 0 then
    select * into v_promo from public.check_promo(p_promo_code, v_user, v_subtotal);
    if v_promo.reason is not null then
      raise exception '%', v_promo.reason using errcode = 'P0010';
    end if;
    v_discount   := v_promo.discount_paise;
    v_promo_id   := v_promo.promo_id;
    v_promo_code := v_promo.code;
  end if;

  v_fee := case
    when v_subtotal >= v_settings.free_delivery_over_paise then 0
    else v_settings.delivery_fee_paise
  end;

  if v_method = 'online' then
    v_pay_status  := 'claimed';
    v_paid_amount := coalesce(p_paid_amount_paise, v_subtotal - v_discount + v_fee);
    v_paid_at     := now();
    if v_paid_amount < 0 then
      raise exception 'Invalid amount.' using errcode = 'P0018';
    end if;
  end if;

  begin
    insert into public.orders (
      user_id, ship_full_name, ship_phone,
      ship_house_no, ship_building, ship_colony, ship_landmark, ship_city, ship_pincode,
      ship_line1, ship_line2,
      delivery_slot, notes,
      subtotal_paise, discount_paise, delivery_fee_paise, total_paise,
      promo_code, promo_id, payment_method, payment_status,
      paid_amount_paise, paid_reference, paid_at, idempotency_key
    ) values (
      v_user, v_addr.full_name, v_addr.phone,
      v_addr.house_no, v_addr.building, v_addr.colony, v_addr.landmark,
      v_addr.city, v_addr.pincode,
      v_addr.line1, v_addr.line2,
      p_delivery_slot, coalesce(p_notes, ''),
      v_subtotal, v_discount, v_fee, (v_subtotal - v_discount + v_fee),
      v_promo_code, v_promo_id, v_method, v_pay_status,
      v_paid_amount, nullif(trim(coalesce(p_paid_reference, '')), ''), v_paid_at,
      p_idempotency_key
    ) returning * into v_order;
  exception
    when unique_violation then
      select * into v_existing from public.orders
        where idempotency_key = p_idempotency_key and user_id = v_user;
      if found then
        return query select v_existing.id, v_existing.order_no, v_existing.total_paise;
        return;
      end if;
      raise;
  end;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_variant_id := (v_item->>'variant_id')::uuid;
    v_qty        := (v_item->>'qty')::int;

    select pv.id, pv.label, pv.unit, pv.price_paise,
           p.id as product_id, p.name as product_name, p.image_path, p.image_url
      into v_v
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
     where pv.id = v_variant_id;

    insert into public.order_items (
      order_id, product_id, variant_id, product_name, variant_label,
      unit, image_path, image_url, unit_price_paise, qty, line_total_paise
    ) values (
      v_order.id, v_v.product_id, v_v.id, v_v.product_name, v_v.label,
      v_v.unit, v_v.image_path, v_v.image_url, v_v.price_paise, v_qty,
      v_v.price_paise * v_qty
    );
  end loop;

  if v_promo_id is not null then
    insert into public.promo_redemptions (promo_id, user_id, order_id, discount_paise)
    values (v_promo_id, v_user, v_order.id, v_discount);
  end if;

  insert into public.order_status_history (order_id, status, note, changed_by)
  values (v_order.id, 'placed',
          case when v_method = 'online'
               then 'Order placed · customer reports paying ₹' || (v_paid_amount / 100)::text || ' online'
               else 'Order placed · cash on delivery' end,
          v_user);

  return query select v_order.id, v_order.order_no, v_order.total_paise;
end;
$$;

grant execute on function public.place_order(jsonb, uuid, text, text, text, text, text, int, text)
  to authenticated;
