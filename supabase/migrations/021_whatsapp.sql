-- Sabji · WhatsApp ordering
--
-- One bot number serves every shop. A customer reaches a particular shop by
-- scanning that shop's QR, which opens WhatsApp with "Hello <SHOP_ID>" already
-- typed. Sending it maps their number to the shop; from then on the bot knows
-- who they are talking to. A number mapped to several shops is asked to pick.
--
-- The bot runs as the service role inside an Edge Function, so it acts on the
-- customer's behalf: it creates them an auth user on first contact and places
-- orders as that user. place_order() gains an "as user" parameter that ONLY
-- the service role may use.

-- ================================================================ tables
create table if not exists public.wa_contacts (
  phone        text primary key,              -- E.164 without +, as Meta sends it
  name         text not null default '',      -- from the WhatsApp profile
  user_id      uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.wa_contact_tenants (
  phone      text not null references public.wa_contacts(phone) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (phone, tenant_id)
);

-- The conversation. One row per number; the bot rewrites it on every turn.
create table if not exists public.wa_sessions (
  phone      text primary key references public.wa_contacts(phone) on delete cascade,
  tenant_id  uuid references public.tenants(id) on delete set null,
  state      text not null default 'idle',
  cart       jsonb not null default '[]'::jsonb,   -- [{variant_id, name, unit, qty, price_paise}]
  context    jsonb not null default '{}'::jsonb,   -- whatever the current state needs
  updated_at timestamptz not null default now()
);

-- Every inbound message id Meta gives us. Meta retries on anything but a fast
-- 200, so this is what makes a duplicate delivery harmless.
create table if not exists public.wa_messages (
  wamid      text primary key,
  phone      text not null,
  direction  text not null check (direction in ('in', 'out')),
  type       text not null,
  body       text not null default '',
  tenant_id  uuid references public.tenants(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists wa_messages_phone_idx on public.wa_messages(phone, created_at desc);

-- All bot tables are service-role only. Nothing in the browser reads them
-- except the admin's read-only view below.
alter table public.wa_contacts        enable row level security;
alter table public.wa_contact_tenants enable row level security;
alter table public.wa_sessions        enable row level security;
alter table public.wa_messages        enable row level security;

create policy "admin sees own shop's contacts" on public.wa_contact_tenants
  for select using (public.is_admin_of(tenant_id));
create policy "admin sees own shop's messages" on public.wa_messages
  for select using (tenant_id is not null and public.is_admin_of(tenant_id));

-- ================================================================ place order
-- Adds p_tenant_id (which shop) and p_as_user (the bot placing for a customer).
create or replace function public.place_order(
  p_items             jsonb,
  p_address_id        uuid,
  p_delivery_slot     text,
  p_notes             text,
  p_idempotency_key   text,
  p_promo_code        text default null,
  p_payment_method    text default 'cod',
  p_paid_amount_paise int  default null,
  p_paid_reference    text default null,
  p_tenant_id         uuid default null,
  p_as_user           uuid default null,
  p_channel           text default 'web'
)
returns table (order_id uuid, order_no text, total_paise int)
language plpgsql security definer set search_path = public
as $$
declare
  v_user        uuid;
  v_tenant      uuid;
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
  -- Only the service role (the bot) may act as somebody else.
  if p_as_user is not null then
    if coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'Not authorised.' using errcode = '42501';
    end if;
    v_user := p_as_user;
  else
    v_user := auth.uid();
  end if;
  if v_user is null then
    raise exception 'You must be signed in to place an order.' using errcode = '42501';
  end if;

  select * into v_existing from public.orders
    where idempotency_key = p_idempotency_key and user_id = v_user;
  if found then
    return query select v_existing.id, v_existing.order_no, v_existing.total_paise;
    return;
  end if;

  -- Which shop. Explicit, else the only shop that exists (single-tenant installs).
  v_tenant := p_tenant_id;
  if v_tenant is null then
    select id into v_tenant from public.tenants where is_active order by created_at limit 1;
  end if;
  if not exists (select 1 from public.tenants where id = v_tenant and is_active) then
    raise exception 'This shop is not taking orders right now.' using errcode = 'P0023';
  end if;

  select * into v_settings from public.settings where tenant_id = v_tenant;
  if not found or not v_settings.is_shop_open then
    raise exception '%', coalesce(v_settings.closed_message, 'Shop is closed right now.')
      using errcode = 'P0001';
  end if;

  if v_method not in ('cod', 'online') then
    raise exception 'Unknown payment method.' using errcode = 'P0016';
  end if;
  if v_method = 'online'
     and not (v_settings.online_payment_enabled and v_settings.payment_qr_path is not null) then
    raise exception 'Online payment is not available right now. Please choose cash on delivery.'
      using errcode = 'P0017';
  end if;

  select * into v_addr from public.addresses a
    where a.id = p_address_id
      and a.user_id in (select p.id from public.profiles p
                         where p.phone is not null
                           and p.phone = (select phone from public.profiles where id = v_user)
                        union select v_user);
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
    select pv.id, pv.price_paise, pv.in_stock, p.name as product_name, p.is_active, p.tenant_id
      into v_v
      from public.product_variants pv join public.products p on p.id = pv.product_id
     where pv.id = v_variant_id;
    if not found or v_v.tenant_id <> v_tenant then
      raise exception 'An item in your cart is no longer available.' using errcode = 'P0005';
    end if;
    if not v_v.is_active or not v_v.in_stock then
      raise exception '% is out of stock.', v_v.product_name using errcode = 'P0006';
    end if;
    v_subtotal := v_subtotal + (v_v.price_paise * v_qty);
  end loop;

  if v_subtotal < v_settings.min_order_paise then
    raise exception 'Minimum order is ₹%.', (v_settings.min_order_paise / 100) using errcode = 'P0007';
  end if;

  if p_promo_code is not null and length(trim(p_promo_code)) > 0 then
    select * into v_promo from public.check_promo(p_promo_code, v_user, v_subtotal, v_tenant);
    if v_promo.reason is not null then
      raise exception '%', v_promo.reason using errcode = 'P0010';
    end if;
    v_discount := v_promo.discount_paise; v_promo_id := v_promo.promo_id; v_promo_code := v_promo.code;
  end if;

  v_fee := case when v_subtotal >= v_settings.free_delivery_over_paise then 0
                else v_settings.delivery_fee_paise end;

  if v_method = 'online' then
    v_pay_status := 'claimed';
    v_paid_amount := coalesce(p_paid_amount_paise, v_subtotal - v_discount + v_fee);
    v_paid_at := now();
    if v_paid_amount < 0 then raise exception 'Invalid amount.' using errcode = 'P0018'; end if;
  end if;

  begin
    insert into public.orders (
      user_id, tenant_id, channel, ship_full_name, ship_phone,
      ship_house_no, ship_building, ship_colony, ship_landmark, ship_city, ship_pincode,
      ship_line1, ship_line2, delivery_slot, notes,
      subtotal_paise, discount_paise, delivery_fee_paise, total_paise,
      promo_code, promo_id, payment_method, payment_status,
      paid_amount_paise, paid_reference, paid_at, idempotency_key
    ) values (
      v_user, v_tenant, coalesce(p_channel, 'web'), v_addr.full_name, v_addr.phone,
      v_addr.house_no, v_addr.building, v_addr.colony, v_addr.landmark, v_addr.city, v_addr.pincode,
      v_addr.line1, v_addr.line2, p_delivery_slot, coalesce(p_notes, ''),
      v_subtotal, v_discount, v_fee, (v_subtotal - v_discount + v_fee),
      v_promo_code, v_promo_id, v_method, v_pay_status,
      v_paid_amount, nullif(trim(coalesce(p_paid_reference, '')), ''), v_paid_at,
      p_idempotency_key
    ) returning * into v_order;
  exception when unique_violation then
    select * into v_existing from public.orders
      where idempotency_key = p_idempotency_key and user_id = v_user;
    if found then
      return query select v_existing.id, v_existing.order_no, v_existing.total_paise; return;
    end if;
    raise;
  end;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_variant_id := (v_item->>'variant_id')::uuid;
    v_qty        := (v_item->>'qty')::int;
    select pv.id, pv.label, pv.unit, pv.price_paise,
           p.id as product_id, p.name as product_name, p.image_path, p.image_url
      into v_v
      from public.product_variants pv join public.products p on p.id = pv.product_id
     where pv.id = v_variant_id;
    insert into public.order_items (
      order_id, product_id, variant_id, product_name, variant_label,
      unit, image_path, image_url, unit_price_paise, qty, line_total_paise
    ) values (
      v_order.id, v_v.product_id, v_v.id, v_v.product_name, v_v.label,
      v_v.unit, v_v.image_path, v_v.image_url, v_v.price_paise, v_qty, v_v.price_paise * v_qty
    );
  end loop;

  if v_promo_id is not null then
    insert into public.promo_redemptions (promo_id, user_id, order_id, discount_paise)
    values (v_promo_id, v_user, v_order.id, v_discount);
  end if;

  insert into public.order_status_history (order_id, status, note, changed_by)
  values (v_order.id, 'placed',
          case when p_channel = 'whatsapp' then 'Order placed on WhatsApp'
               when v_method = 'online' then 'Order placed · customer reports paying ₹' || (v_paid_amount / 100)::text || ' online'
               else 'Order placed · cash on delivery' end,
          v_user);

  return query select v_order.id, v_order.order_no, v_order.total_paise;
end $$;

drop function if exists public.place_order(jsonb, uuid, text, text, text, text, text, int, text);
grant execute on function public.place_order(jsonb, uuid, text, text, text, text, text, int, text, uuid, uuid, text)
  to authenticated, service_role;

-- The catalogue the bot hands to Gemini: compact, one shop, in-stock only.
create or replace function public.bot_catalogue(p_tenant uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'variant_id', v.id,
           'name', p.name,
           'variant', case when v.label = 'Default' then null else v.label end,
           'unit', v.unit,
           'price', v.price_paise / 100.0
         ) order by p.sort_order, v.sort_order), '[]'::jsonb)
    from public.products p
    join public.product_variants v on v.product_id = p.id
   where p.tenant_id = p_tenant and p.is_active and v.in_stock;
$$;
grant execute on function public.bot_catalogue(uuid) to service_role;
