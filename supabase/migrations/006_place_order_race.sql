-- Sabji · make place_order() idempotent under CONCURRENT duplicate submits
--
-- The original pre-check ("has this key been used?") only covers a repeat that
-- arrives after the first has committed. Two taps on a slow connection fire at
-- the same time: both see no existing order, both insert, and the loser hits the
-- unique constraint and raises. The data stayed correct — one order — but the
-- customer saw an error for an order that had in fact been placed.
--
-- Now the loser catches the violation and returns the winner's order, so both
-- callers get the same successful answer.

create or replace function public.place_order(
  p_items           jsonb,
  p_address_id      uuid,
  p_delivery_slot   text,
  p_notes           text,
  p_idempotency_key text
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
  v_subtotal   int := 0;
  v_fee        int := 0;
  v_line       int;
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

    select pv.id, pv.label, pv.unit, pv.price_paise, pv.in_stock,
           p.id as product_id, p.name as product_name, p.image_path, p.is_active
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

    v_line     := v_v.price_paise * v_qty;
    v_subtotal := v_subtotal + v_line;
  end loop;

  if v_subtotal < v_settings.min_order_paise then
    raise exception 'Minimum order is ₹%.', (v_settings.min_order_paise / 100)
      using errcode = 'P0007';
  end if;

  v_fee := case
    when v_subtotal >= v_settings.free_delivery_over_paise then 0
    else v_settings.delivery_fee_paise
  end;

  -- The insert and everything after it sit in their own block so a concurrent
  -- duplicate can be turned into a successful, identical response.
  begin
    insert into public.orders (
      user_id, ship_full_name, ship_phone, ship_line1, ship_line2,
      ship_landmark, ship_pincode, delivery_slot, notes,
      subtotal_paise, delivery_fee_paise, total_paise,
      payment_method, idempotency_key
    ) values (
      v_user, v_addr.full_name, v_addr.phone, v_addr.line1, v_addr.line2,
      v_addr.landmark, v_addr.pincode, p_delivery_slot, coalesce(p_notes, ''),
      v_subtotal, v_fee, v_subtotal + v_fee,
      'cod', p_idempotency_key
    ) returning * into v_order;
  exception
    when unique_violation then
      -- Another request with this key won the race. Return its order.
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
      v_v.unit, v_v.image_path, v_v.image_url, v_v.price_paise, v_qty, v_v.price_paise * v_qty
    );
  end loop;

  insert into public.order_status_history (order_id, status, note, changed_by)
  values (v_order.id, 'placed', 'Order placed by customer', v_user);

  return query select v_order.id, v_order.order_no, v_order.total_paise;
end;
$$;

grant execute on function public.place_order(jsonb, uuid, text, text, text) to authenticated;
