-- Sabji · UPI QR payment
--
-- The shop uploads a payment QR. At checkout a customer may choose "Pay online",
-- scan it in their own UPI app, and then tell us they have paid.
--
-- IMPORTANT, and reflected throughout the naming: nothing here VERIFIES that
-- money arrived. There is no payment gateway and no webhook. What the customer
-- taps is a CLAIM. So the order carries:
--
--   pending   -> cash on delivery, or online but not yet claimed
--   claimed   -> the customer says they paid, with an amount and a timestamp
--   confirmed -> the shop checked their own UPI app and agreed
--
-- The admin badge distinguishes the last two, so nobody hands over vegetables
-- on the strength of a tap alone.

-- ---------------------------------------------------------------- settings
alter table public.settings
  add column if not exists payment_qr_path        text,
  add column if not exists upi_id                 text not null default '',
  add column if not exists online_payment_enabled boolean not null default false,
  add column if not exists payment_note           text not null default
    'Scan with any UPI app, pay, then enter the amount below.';

-- ---------------------------------------------------------------- orders
do $$ begin
  alter table public.orders
    add constraint payment_method_known check (payment_method in ('cod', 'online'));
exception when duplicate_object then null; end $$;

alter table public.orders
  add column if not exists payment_status       text not null default 'pending',
  add column if not exists paid_amount_paise    int,
  add column if not exists paid_reference       text,
  add column if not exists paid_at              timestamptz,
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists payment_confirmed_by uuid references auth.users(id) on delete set null;

do $$ begin
  alter table public.orders
    add constraint payment_status_known
    check (payment_status in ('pending', 'claimed', 'confirmed'));
exception when duplicate_object then null; end $$;

create index if not exists orders_payment_idx on public.orders(payment_status, placed_at desc);

-- ---------------------------------------------------------------- place order
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

  -- A claim, not a verified payment. The amount is whatever the customer says
  -- they sent; the shop reconciles it against their own UPI app afterwards.
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
      user_id, ship_full_name, ship_phone, ship_line1, ship_line2,
      ship_landmark, ship_pincode, delivery_slot, notes,
      subtotal_paise, discount_paise, delivery_fee_paise, total_paise,
      promo_code, promo_id, payment_method, payment_status,
      paid_amount_paise, paid_reference, paid_at, idempotency_key
    ) values (
      v_user, v_addr.full_name, v_addr.phone, v_addr.line1, v_addr.line2,
      v_addr.landmark, v_addr.pincode, p_delivery_slot, coalesce(p_notes, ''),
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

-- The older 6-argument signature would otherwise sit alongside this one and
-- make calls ambiguous (the mistake 012 had to clean up).
drop function if exists public.place_order(jsonb, uuid, text, text, text, text);

-- ---------------------------------------------------------------- confirm
-- The shop checks their own UPI app and agrees the money arrived.
create or replace function public.confirm_order_payment(
  p_order_id uuid,
  p_confirmed boolean default true
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  update public.orders
     set payment_status       = case when p_confirmed then 'confirmed' else 'claimed' end,
         payment_confirmed_at = case when p_confirmed then now() else null end,
         payment_confirmed_by = case when p_confirmed then auth.uid() else null end
   where id = p_order_id
     and payment_method = 'online';

  if not found then
    raise exception 'That order was not paid online.' using errcode = 'P0019';
  end if;

  insert into public.order_status_history (order_id, status, note, changed_by)
  select id,
         status,
         case when p_confirmed then 'Payment confirmed by the shop'
              else 'Payment confirmation withdrawn' end,
         auth.uid()
    from public.orders where id = p_order_id;
end;
$$;

grant execute on function public.confirm_order_payment(uuid, boolean) to authenticated;
