-- Sabji · order placement and admin transitions
--
-- place_order() is the ONLY way an order gets created. It runs as a single
-- transaction and enforces three things the client must never be trusted with:
--   1. Prices come from the database, not the request body.
--   2. Prices are copied into the order line, not referenced.
--   3. Re-sending the same idempotency_key returns the SAME order.

create or replace function public.place_order(
  p_items           jsonb,     -- [{"variant_id": "...", "qty": 2}, ...]
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

  -- Idempotency: a double tap returns the first order rather than a second one.
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

  -- Price every line from the database.
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

  -- Second pass: snapshot each line into the order.
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


-- ---------------------------------------------------------------- transitions
-- Admin moves an order forward. Illegal jumps are rejected here rather than
-- being left to the UI to prevent.
create or replace function public.set_order_status(
  p_order_id uuid,
  p_status   public.order_status,
  p_note     text default ''
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_current public.order_status;
  v_allowed public.order_status[];
begin
  if not public.is_admin() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  select status into v_current from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  v_allowed := case v_current
    when 'placed'           then array['confirmed','cancelled']::public.order_status[]
    when 'confirmed'        then array['packed','cancelled']::public.order_status[]
    when 'packed'           then array['out_for_delivery','cancelled']::public.order_status[]
    when 'out_for_delivery' then array['delivered','cancelled']::public.order_status[]
    else array[]::public.order_status[]
  end;

  if not (p_status = any(v_allowed)) then
    raise exception 'Cannot move an order from % to %.', v_current, p_status
      using errcode = 'P0008';
  end if;

  update public.orders
     set status = p_status,
         cancel_reason = case when p_status = 'cancelled' then nullif(p_note,'') else cancel_reason end
   where id = p_order_id;

  insert into public.order_status_history (order_id, status, note, changed_by)
  values (p_order_id, p_status, coalesce(p_note,''), auth.uid());
end;
$$;

grant execute on function public.set_order_status(uuid, public.order_status, text) to authenticated;


-- Customer-side cancel, allowed only before the order is packed.
create or replace function public.cancel_my_order(p_order_id uuid, p_reason text default '')
returns void
language plpgsql security definer set search_path = public
as $$
declare v_o public.orders%rowtype;
begin
  select * into v_o from public.orders where id = p_order_id and user_id = auth.uid();
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

grant execute on function public.cancel_my_order(uuid, text) to authenticated;


-- ---------------------------------------------------------------- admin summary
create or replace function public.admin_daily_summary(p_days int default 7)
returns table (day date, orders bigint, revenue_paise bigint)
language sql stable security definer set search_path = public
as $$
  select date_trunc('day', placed_at)::date as day,
         count(*)                            as orders,
         coalesce(sum(total_paise), 0)       as revenue_paise
    from public.orders
   where public.is_admin()
     and status <> 'cancelled'
     and placed_at >= now() - (p_days || ' days')::interval
   group by 1 order by 1 desc;
$$;

grant execute on function public.admin_daily_summary(int) to authenticated;
