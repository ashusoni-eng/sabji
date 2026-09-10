-- Sabji · two fixes to the promo functions
--
-- BUG 1 — every checkout failed, promo or not:
--   "record v_promo is not assigned yet"
-- v_promo is only assigned inside the "if a promo code was given" branch, but
-- the INSERT referenced v_promo.code unconditionally. A plain order never
-- touched that branch, so the record had no tuple structure. Fixed by holding
-- the code in a plain text variable that defaults to null.
--
-- BUG 2 — no promo code ever validated:
--   "column reference promo_id is ambiguous"
-- promo_id is both an OUT parameter of check_promo and a column of
-- promo_redemptions, and PL/pgSQL refuses to guess. once_per_user is always
-- true, so this fired on every single check. Fixed by aliasing the table so
-- every column reference is qualified.

-- BUG 3 — "function public.set_order_status(uuid, unknown, unknown) is not unique"
-- Adding a parameter with a DEFAULT does not replace the old function; it
-- creates an overload beside it, and a call that matches both is ambiguous.
-- 003 made set_order_status/3 and place_order/5; 010 and 009 added a 4-arg and
-- a 6-arg version. Drop the superseded signatures so exactly one of each remains.
drop function if exists public.set_order_status(uuid, public.order_status, text);
drop function if exists public.place_order(jsonb, uuid, text, text, text);


create or replace function public.check_promo(
  p_code     text,
  p_user     uuid,
  p_subtotal int
)
returns table (promo_id uuid, code text, discount_paise int, reason text)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_p    public.promo_codes%rowtype;
  v_used int;
  v_all  int;
  v_disc int;
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
    -- Aliased so `r.promo_id` cannot be mistaken for the OUT parameter.
    select count(*) into v_all from public.promo_redemptions r where r.promo_id = v_p.id;
    if v_all >= v_p.max_redemptions then
      return query select null::uuid, v_p.code, 0, 'That code has been fully claimed.'; return;
    end if;
  end if;

  if v_p.once_per_user then
    select count(*) into v_used from public.promo_redemptions r
     where r.promo_id = v_p.id and r.user_id = p_user;
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

grant execute on function public.check_promo(text, uuid, int) to authenticated;


create or replace function public.place_order(
  p_items           jsonb,
  p_address_id      uuid,
  p_delivery_slot   text,
  p_notes           text,
  p_idempotency_key text,
  p_promo_code      text default null
)
returns table (order_id uuid, order_no text, total_paise int)
language plpgsql security definer set search_path = public
as $$
declare
  v_user       uuid := auth.uid();
  v_addr       public.addresses%rowtype;
  v_settings   public.settings%rowtype;
  v_order      public.orders%rowtype;
  v_existing   public.orders%rowtype;
  v_item       jsonb;
  v_variant_id uuid;
  v_qty        int;
  v_v          record;
  v_promo      record;
  v_subtotal   int  := 0;
  v_discount   int  := 0;
  v_promo_id   uuid := null;
  v_promo_code text := null;   -- plain text, so a plain order needs no record
  v_fee        int  := 0;
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

  select * into v_addr from public.addresses
    where id = p_address_id and user_id = v_user;
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

  begin
    insert into public.orders (
      user_id, ship_full_name, ship_phone, ship_line1, ship_line2,
      ship_landmark, ship_pincode, delivery_slot, notes,
      subtotal_paise, discount_paise, delivery_fee_paise, total_paise,
      promo_code, promo_id, payment_method, idempotency_key
    ) values (
      v_user, v_addr.full_name, v_addr.phone, v_addr.line1, v_addr.line2,
      v_addr.landmark, v_addr.pincode, p_delivery_slot, coalesce(p_notes, ''),
      v_subtotal, v_discount, v_fee, (v_subtotal - v_discount + v_fee),
      v_promo_code, v_promo_id, 'cod', p_idempotency_key
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
  values (v_order.id, 'placed', 'Order placed by customer', v_user);

  return query select v_order.id, v_order.order_no, v_order.total_paise;
end;
$$;

grant execute on function public.place_order(jsonb, uuid, text, text, text, text) to authenticated;
