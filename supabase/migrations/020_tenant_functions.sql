-- Sabji · every function learns which shop it is acting for

-- ================================================================ superadmin
create or replace function public.super_create_tenant(
  p_name text, p_pincode text, p_admin_phone text, p_admin_name text default ''
)
returns table (tenant_id uuid, shop_id text)
language plpgsql security definer set search_path = public
as $$
declare v_t uuid; v_sid text;
begin
  if not public.is_superadmin() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if length(trim(p_name)) < 2 then
    raise exception 'Give the shop a name.' using errcode = 'P0021';
  end if;
  if p_admin_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Admin phone must be in international form, e.g. +919876543210.'
      using errcode = 'P0014';
  end if;
  if exists (select 1 from public.staff_phones where phone = p_admin_phone) then
    raise exception 'That number is already staff at another shop.' using errcode = 'P0022';
  end if;

  v_sid := public.generate_shop_id(p_name, p_pincode);
  insert into public.tenants (shop_id, name, pincode, created_by)
  values (v_sid, trim(p_name), regexp_replace(p_pincode, '\D', '', 'g'), auth.uid())
  returning id into v_t;

  insert into public.staff_phones (phone, role, name, tenant_id)
  values (p_admin_phone, 'admin', coalesce(p_admin_name, ''), v_t);
  -- Apply immediately if that person already has an account.
  update public.profiles set phone = phone where phone = p_admin_phone;

  return query select v_t, v_sid;
end;
$$;

create or replace function public.super_list_tenants()
returns table (id uuid, shop_id text, name text, pincode text, is_active boolean,
               created_at timestamptz, admin_phone text, admin_name text,
               orders bigint, products bigint)
language sql stable security definer set search_path = public
as $$
  select t.id, t.shop_id, t.name, t.pincode, t.is_active, t.created_at,
         (select s.phone from public.staff_phones s where s.tenant_id = t.id and s.role = 'admin' order by s.created_at limit 1),
         (select s.name  from public.staff_phones s where s.tenant_id = t.id and s.role = 'admin' order by s.created_at limit 1),
         (select count(*) from public.orders o where o.tenant_id = t.id),
         (select count(*) from public.products p where p.tenant_id = t.id)
    from public.tenants t
   where public.is_superadmin()
   order by t.created_at desc;
$$;

create or replace function public.super_update_tenant(
  p_tenant uuid, p_name text default null, p_is_active boolean default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_superadmin() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  update public.tenants
     set name      = coalesce(nullif(trim(p_name), ''), name),
         is_active = coalesce(p_is_active, is_active)
   where id = p_tenant;
end $$;

create or replace function public.super_set_bot_number(p_number text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_superadmin() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  update public.platform set whatsapp_bot_number = regexp_replace(p_number, '\D', '', 'g'),
                             updated_at = now() where id = 1;
end $$;

grant execute on function public.super_create_tenant(text, text, text, text) to authenticated;
grant execute on function public.super_list_tenants()                        to authenticated;
grant execute on function public.super_update_tenant(uuid, text, boolean)    to authenticated;
grant execute on function public.super_set_bot_number(text)                  to authenticated;

-- ================================================================ staff
create or replace function public.admin_list_staff()
returns table (phone text, role public.user_role, name text, note text,
               has_account boolean, full_name text)
language sql stable security definer set search_path = public
as $$
  select s.phone, s.role, s.name, s.note,
         exists (select 1 from public.profiles p where p.phone = s.phone),
         coalesce((select nullif(p.full_name,'') from public.profiles p
                    where p.phone = s.phone and nullif(p.full_name,'') is not null
                    order by p.created_at desc limit 1), '')
    from public.staff_phones s
   where public.is_admin() and s.tenant_id = public.my_tenant()
   order by s.role, s.name, s.phone;
$$;

create or replace function public.admin_set_staff(
  p_phone text, p_role public.user_role, p_name text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare v_t uuid := public.my_tenant();
begin
  if not public.is_admin() or v_t is null then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter the number in international form, e.g. +919876543210.'
      using errcode = 'P0014';
  end if;
  if exists (select 1 from public.staff_phones where phone = p_phone and tenant_id <> v_t) then
    raise exception 'That number is already staff at another shop.' using errcode = 'P0022';
  end if;

  insert into public.staff_phones (phone, role, name, tenant_id)
  values (p_phone, p_role, coalesce(p_name, ''), v_t)
  on conflict (phone) do update set role = excluded.role, name = excluded.name;
  update public.profiles set phone = phone where phone = p_phone;
end $$;

create or replace function public.admin_remove_staff(p_phone text)
returns void language plpgsql security definer set search_path = public as $$
declare v_t uuid := public.my_tenant();
begin
  if not public.is_admin() or v_t is null then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.staff_phones where phone = p_phone and tenant_id = v_t) then
    raise exception 'Not on your staff list.' using errcode = 'P0002';
  end if;
  if (select role from public.staff_phones where phone = p_phone) = 'admin'
     and (select count(*) from public.staff_phones where role = 'admin' and tenant_id = v_t) <= 1 then
    raise exception 'This is the only admin. Add another before removing this one.'
      using errcode = 'P0015';
  end if;
  delete from public.staff_phones where phone = p_phone and tenant_id = v_t;
  update public.profiles set role = 'customer', is_admin = false, tenant_id = null where phone = p_phone;
end $$;

-- ================================================================ riders
create or replace function public.list_riders()
returns table (id uuid, full_name text, phone text, active_orders bigint)
language sql stable security definer set search_path = public
as $$
  select distinct on (p.phone)
         p.id,
         coalesce(nullif(p.full_name, ''), s.name, 'Rider'),
         p.phone,
         (select count(*) from public.orders o
           join public.profiles rp on rp.id = o.delivery_person_id
          where rp.phone = p.phone and o.status = 'out_for_delivery'
            and o.tenant_id = public.my_tenant())
    from public.profiles p
    join public.staff_phones s on s.phone = p.phone
   where public.is_admin()
     and s.tenant_id = public.my_tenant()
     and p.role = 'delivery'
     and p.phone is not null
   order by p.phone, p.created_at desc;
$$;

-- ================================================================ summary
create or replace function public.admin_daily_summary(p_days int default 7)
returns table (day date, orders bigint, revenue_paise bigint)
language sql stable security definer set search_path = public
as $$
  select date_trunc('day', placed_at)::date, count(*), coalesce(sum(total_paise), 0)
    from public.orders
   where public.is_admin()
     and tenant_id = public.my_tenant()
     and status <> 'cancelled'
     and placed_at >= now() - (p_days || ' days')::interval
   group by 1 order by 1 desc;
$$;

-- ================================================================ transitions
create or replace function public.set_order_status(
  p_order_id uuid, p_status public.order_status, p_note text default '', p_rider_id uuid default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_current  public.order_status;
  v_assigned uuid;
  v_tenant   uuid;
  v_allowed  public.order_status[];
  v_rider    uuid := p_rider_id;
  v_phones   int;
  v_is_admin boolean;
begin
  select status, delivery_person_id, tenant_id into v_current, v_assigned, v_tenant
    from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;
  v_is_admin := public.is_admin_of(v_tenant);

  if not v_is_admin then
    if not (public.is_delivery()
            and v_assigned in (select public.my_user_ids())
            and v_current = 'out_for_delivery'
            and p_status = 'delivered') then
      raise exception 'Not authorised.' using errcode = '42501';
    end if;
  end if;

  v_allowed := case v_current
    when 'placed'           then array['confirmed','cancelled']::public.order_status[]
    when 'confirmed'        then array['packed','cancelled']::public.order_status[]
    when 'packed'           then array['out_for_delivery','cancelled']::public.order_status[]
    when 'out_for_delivery' then array['delivered','cancelled']::public.order_status[]
    else array[]::public.order_status[]
  end;
  if not (p_status = any(v_allowed)) then
    raise exception 'Cannot move an order from % to %.', v_current, p_status using errcode = 'P0008';
  end if;

  if p_status = 'out_for_delivery' then
    if v_rider is null then
      select count(distinct p.phone) into v_phones
        from public.profiles p join public.staff_phones s on s.phone = p.phone
       where p.role = 'delivery' and s.tenant_id = v_tenant;
      if v_phones = 1 then
        select p.id into v_rider from public.profiles p join public.staff_phones s on s.phone = p.phone
         where p.role = 'delivery' and s.tenant_id = v_tenant order by p.created_at desc limit 1;
      elsif v_phones = 0 then
        raise exception 'Add a delivery person before sending orders out.' using errcode = 'P0011';
      else
        raise exception 'Choose which delivery person is taking this order.' using errcode = 'P0012';
      end if;
    end if;
    if not exists (select 1 from public.profiles p join public.staff_phones s on s.phone = p.phone
                    where p.id = v_rider and p.role = 'delivery' and s.tenant_id = v_tenant) then
      raise exception 'That person is not a delivery rider at this shop.' using errcode = 'P0013';
    end if;
    update public.orders set delivery_person_id = v_rider where id = p_order_id;
  end if;

  update public.orders
     set status = p_status,
         cancel_reason = case when p_status = 'cancelled' then nullif(p_note,'') else cancel_reason end
   where id = p_order_id;
  insert into public.order_status_history (order_id, status, note, changed_by)
  values (p_order_id, p_status, coalesce(p_note,''), auth.uid());
end $$;

create or replace function public.confirm_order_payment(p_order_id uuid, p_confirmed boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.orders where id = p_order_id;
  if not public.is_admin_of(v_tenant) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  update public.orders
     set payment_status       = case when p_confirmed then 'confirmed' else 'claimed' end,
         payment_confirmed_at = case when p_confirmed then now() else null end,
         payment_confirmed_by = case when p_confirmed then auth.uid() else null end
   where id = p_order_id and payment_method = 'online';
  if not found then
    raise exception 'That order was not paid online.' using errcode = 'P0019';
  end if;
  insert into public.order_status_history (order_id, status, note, changed_by)
  select id, status,
         case when p_confirmed then 'Payment confirmed by the shop' else 'Payment confirmation withdrawn' end,
         auth.uid()
    from public.orders where id = p_order_id;
end $$;

-- ================================================================ promos
create or replace function public.check_promo(
  p_code text, p_user uuid, p_subtotal int, p_tenant uuid
)
returns table (promo_id uuid, code text, discount_paise int, reason text)
language plpgsql stable security definer set search_path = public
as $$
declare v_p public.promo_codes%rowtype; v_used int; v_all int; v_disc int; v_phone text;
begin
  select * into v_p from public.promo_codes pc
   where upper(pc.code) = upper(trim(p_code)) and pc.tenant_id = p_tenant;
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
      from public.promo_redemptions r join public.profiles rp on rp.id = r.user_id
     where r.promo_id = v_p.id
       and (r.user_id = p_user or (v_phone is not null and rp.phone = v_phone));
    if v_used > 0 then
      return query select null::uuid, v_p.code, 0, 'You have already used this code.'; return;
    end if;
  end if;
  v_disc := case v_p.kind when 'percent' then (p_subtotal * v_p.value) / 100 else v_p.value end;
  if v_p.max_discount_paise is not null then v_disc := least(v_disc, v_p.max_discount_paise); end if;
  v_disc := least(v_disc, p_subtotal);
  return query select v_p.id, v_p.code, v_disc, null::text;
end $$;

drop function if exists public.check_promo(text, uuid, int);
drop function if exists public.preview_promo(text, int);

create or replace function public.preview_promo(p_code text, p_subtotal int, p_tenant uuid)
returns table (promo_id uuid, code text, discount_paise int, reason text)
language sql stable security definer set search_path = public as $$
  select * from public.check_promo(p_code, auth.uid(), p_subtotal, p_tenant);
$$;

grant execute on function public.check_promo(text, uuid, int, uuid)  to authenticated;
grant execute on function public.preview_promo(text, int, uuid)      to authenticated;
