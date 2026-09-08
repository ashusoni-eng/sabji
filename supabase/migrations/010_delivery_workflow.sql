-- Sabji · delivery rider workflow

-- Riders see only what they are carrying. Not the whole order book, not other
-- riders' rounds, and nothing before it is handed to them.
drop policy if exists "delivery reads assigned orders" on public.orders;
create policy "delivery reads assigned orders" on public.orders
  for select using (
    delivery_person_id = auth.uid()
    and status in ('out_for_delivery', 'delivered')
  );

drop policy if exists "read own order items" on public.order_items;
create policy "read own order items" on public.order_items
  for select using (
    public.is_admin() or exists (
      select 1 from public.orders o
       where o.id = order_id
         and (o.user_id = auth.uid()
              or (o.delivery_person_id = auth.uid()
                  and o.status in ('out_for_delivery', 'delivered')))
    )
  );

drop policy if exists "read own status history" on public.order_status_history;
create policy "read own status history" on public.order_status_history
  for select using (
    public.is_admin() or exists (
      select 1 from public.orders o
       where o.id = order_id
         and (o.user_id = auth.uid()
              or (o.delivery_person_id = auth.uid()
                  and o.status in ('out_for_delivery', 'delivered')))
    )
  );

-- Riders on the shop's list, for the assign step.
create or replace function public.list_riders()
returns table (id uuid, full_name text, phone text, active_orders bigint)
language sql stable security definer set search_path = public
as $$
  select p.id,
         coalesce(nullif(p.full_name, ''), s.name, 'Rider') as full_name,
         p.phone,
         (select count(*) from public.orders o
           where o.delivery_person_id = p.id and o.status = 'out_for_delivery') as active_orders
    from public.profiles p
    left join public.staff_phones s on s.phone = p.phone
   where public.is_admin()
     and p.role = 'delivery'
   order by 4 asc, 2 asc;
$$;

grant execute on function public.list_riders() to authenticated;


-- Status transitions, now aware of riders.
--   * Moving to out_for_delivery requires a rider. If the shop has exactly one,
--     the caller may omit it and this picks that rider — no needless prompt.
--   * A rider may only move their own assigned order to delivered.
create or replace function public.set_order_status(
  p_order_id  uuid,
  p_status    public.order_status,
  p_note      text default '',
  p_rider_id  uuid default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_current   public.order_status;
  v_assigned  uuid;
  v_allowed   public.order_status[];
  v_rider     uuid := p_rider_id;
  v_count     int;
  v_is_admin  boolean := public.is_admin();
begin
  select status, delivery_person_id into v_current, v_assigned
    from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  -- A rider's only power is to complete their own delivery.
  if not v_is_admin then
    if not (public.is_delivery()
            and v_assigned = auth.uid()
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
    raise exception 'Cannot move an order from % to %.', v_current, p_status
      using errcode = 'P0008';
  end if;

  if p_status = 'out_for_delivery' then
    if v_rider is null then
      -- Exactly one rider on the books: assign without asking.
      select count(*) into v_count from public.profiles where role = 'delivery';
      if v_count = 1 then
        select id into v_rider from public.profiles where role = 'delivery';
      elsif v_count = 0 then
        raise exception 'Add a delivery person before sending orders out.'
          using errcode = 'P0011';
      else
        raise exception 'Choose which delivery person is taking this order.'
          using errcode = 'P0012';
      end if;
    end if;

    if not exists (select 1 from public.profiles where id = v_rider and role = 'delivery') then
      raise exception 'That person is not a delivery rider.' using errcode = 'P0013';
    end if;

    update public.orders set delivery_person_id = v_rider where id = p_order_id;
  end if;

  update public.orders
     set status = p_status,
         cancel_reason = case when p_status = 'cancelled'
                              then nullif(p_note, '') else cancel_reason end
   where id = p_order_id;

  insert into public.order_status_history (order_id, status, note, changed_by)
  values (p_order_id, p_status, coalesce(p_note, ''), auth.uid());
end;
$$;

grant execute on function public.set_order_status(uuid, public.order_status, text, uuid) to authenticated;


-- A rider's round: their live deliveries, newest first.
create or replace function public.my_deliveries(p_include_done boolean default false)
returns setof public.orders
language sql stable security definer set search_path = public
as $$
  select * from public.orders
   where delivery_person_id = auth.uid()
     and (status = 'out_for_delivery'
          or (p_include_done and status = 'delivered'))
   order by status, placed_at;
$$;

grant execute on function public.my_deliveries(boolean) to authenticated;
