-- Sabji · proper Indian address fields
--
-- line1 / line2 were a western "address line 1 / 2" shape, which is a poor fit:
-- a delivery rider here needs the flat number, the building, the colony and a
-- landmark as separate things, not run together in one box.
--
--   house_no   House / Flat No.        required
--   building   Building Name           optional (many addresses have none)
--   colony     Colony / Society Name   required
--   landmark   Landmark                optional, but what riders actually use
--   city       City                    required
--   pincode    Pin code                required
--
-- line1 / line2 are kept and still written, composed from the new fields, so
-- nothing that reads them breaks and old orders stay readable.

alter table public.addresses
  add column if not exists house_no text not null default '',
  add column if not exists building text not null default '',
  add column if not exists colony   text not null default '',
  add column if not exists city     text not null default '';

alter table public.orders
  add column if not exists ship_house_no text not null default '',
  add column if not exists ship_building text not null default '',
  add column if not exists ship_colony   text not null default '',
  add column if not exists ship_city     text not null default '';

-- Existing rows: the old first line was usually "flat, building", the second
-- the colony. Split on the first comma; anything unparseable stays whole in
-- house_no rather than being silently dropped.
update public.addresses
   set house_no = case when position(',' in line1) > 0
                       then btrim(split_part(line1, ',', 1)) else btrim(line1) end,
       building = case when position(',' in line1) > 0
                       then btrim(substr(line1, position(',' in line1) + 1)) else '' end,
       colony   = coalesce(btrim(line2), '')
 where house_no = '' and coalesce(line1, '') <> '';

update public.orders
   set ship_house_no = case when position(',' in ship_line1) > 0
                            then btrim(split_part(ship_line1, ',', 1)) else btrim(ship_line1) end,
       ship_building = case when position(',' in ship_line1) > 0
                            then btrim(substr(ship_line1, position(',' in ship_line1) + 1)) else '' end,
       ship_colony   = coalesce(btrim(ship_line2), '')
 where ship_house_no = '' and coalesce(ship_line1, '') <> '';

-- line1/line2 were NOT NULL with no default; place_order now composes them, but
-- give them defaults so nothing can fail on an insert that omits them.
alter table public.orders
  alter column ship_line1 set default '',
  alter column ship_line2 set default '';
alter table public.addresses
  alter column line1 set default '',
  alter column line2 set default '';

-- Keep the composed lines in step whenever the granular fields change, so the
-- two representations can never drift apart.
create or replace function public.compose_address_lines()
returns trigger
language plpgsql set search_path = public
as $$
begin
  -- concat_ws skips nulls, so no separator is left dangling.
  new.line1 := concat_ws(', ', nullif(btrim(new.house_no), ''), nullif(btrim(new.building), ''));
  new.line2 := coalesce(nullif(btrim(new.colony), ''), '');
  return new;
end;
$$;

drop trigger if exists addresses_compose_lines on public.addresses;
create trigger addresses_compose_lines
  before insert or update on public.addresses
  for each row execute function public.compose_address_lines();


-- ---------------------------------------------------------------- place order
-- Snapshot the granular fields onto the order alongside the composed lines.
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
