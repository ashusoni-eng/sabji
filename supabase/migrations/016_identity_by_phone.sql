-- Sabji · make one phone number behave as one person
--
-- THE CAUSE
-- Dev sign-in (VITE_DEV_STATIC_OTP) uses Supabase anonymous auth, which mints a
-- NEW auth user on every sign-in. sync_my_phone() then stamps the same number
-- onto each new profile, so signing in from six browsers leaves six profiles
-- carrying one number. Real phone OTP does not do this — Supabase reuses the
-- user for a given number — so this disappears once SMS is connected.
--
-- Roles already key off the phone, which is why admin kept working. Everything
-- keyed off the user id did not:
--
--   1. admin_list_staff LEFT JOINed profiles on phone, so one staff entry
--      produced one row per profile. Six sign-ins, six identical "Shop admin"
--      rows in the Staff list.
--   2. list_riders returned one entry per profile, so "Shivam" appeared twice
--      with different ids — and having two made the shop pick a rider by hand
--      instead of assigning the only one automatically.
--   3. The admin assigned an order to one of Shivam's profiles while Shivam's
--      phone was signed in as the other, so his deliveries list was empty.
--      Reproduced: order assigned to profile cb514af9, session 51a93d6e saw 0.
--
-- THE FIX
-- Treat the phone as the identity everywhere, matching how roles already work.
-- Existing duplicate profiles are left alone — they are real accounts and may
-- own orders; the queries simply stop being confused by them.

-- The caller's number, or null. Used to match "any session of the same person".
create or replace function public.my_phone()
returns text
language sql stable security definer set search_path = public
as $$
  select phone from public.profiles where id = auth.uid();
$$;

grant execute on function public.my_phone() to authenticated;

-- Every user id belonging to the same phone as the caller. Empty when the
-- caller has no number, so it can never accidentally match everybody.
create or replace function public.my_user_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select p.id from public.profiles p
   where p.phone is not null
     and p.phone = (select phone from public.profiles where id = auth.uid());
$$;

grant execute on function public.my_user_ids() to authenticated;


-- ---------------------------------------------------------------- 1. staff
-- One row per staff number, whatever the profile count.
create or replace function public.admin_list_staff()
returns table (phone text, role public.user_role, name text, note text,
               has_account boolean, full_name text)
language sql stable security definer set search_path = public
as $$
  select s.phone,
         s.role,
         s.name,
         s.note,
         exists (select 1 from public.profiles p where p.phone = s.phone) as has_account,
         coalesce(
           (select nullif(p.full_name, '') from public.profiles p
             where p.phone = s.phone and nullif(p.full_name, '') is not null
             order by p.created_at desc limit 1),
           '') as full_name
    from public.staff_phones s
   where public.is_admin()
   order by s.role, s.name, s.phone;
$$;


-- ---------------------------------------------------------------- 2. riders
-- One row per rider number. The id returned is simply a handle for assignment;
-- delivery matching below is by phone, so which profile it points at is moot.
create or replace function public.list_riders()
returns table (id uuid, full_name text, phone text, active_orders bigint)
language sql stable security definer set search_path = public
as $$
  select distinct on (p.phone)
         p.id,
         coalesce(nullif(p.full_name, ''), s.name, 'Rider') as full_name,
         p.phone,
         (select count(*) from public.orders o
           join public.profiles rp on rp.id = o.delivery_person_id
          where rp.phone = p.phone and o.status = 'out_for_delivery') as active_orders
    from public.profiles p
    left join public.staff_phones s on s.phone = p.phone
   where public.is_admin()
     and p.role = 'delivery'
     and p.phone is not null
   order by p.phone, p.created_at desc;
$$;


-- ---------------------------------------------------------------- 3. rounds
create or replace function public.my_deliveries(p_include_done boolean default false)
returns setof public.orders
language sql stable security definer set search_path = public
as $$
  select o.* from public.orders o
   where o.delivery_person_id in (select public.my_user_ids())
     and (o.status = 'out_for_delivery'
          or (p_include_done and o.status = 'delivered'))
   order by o.status, o.placed_at;
$$;


-- ---------------------------------------------------------------- 4. RLS
drop policy if exists "delivery reads assigned orders" on public.orders;
create policy "delivery reads assigned orders" on public.orders
  for select using (
    delivery_person_id in (select public.my_user_ids())
    and status in ('out_for_delivery', 'delivered')
  );

drop policy if exists "read own order items" on public.order_items;
create policy "read own order items" on public.order_items
  for select using (
    public.is_admin() or exists (
      select 1 from public.orders o
       where o.id = order_id
         and (o.user_id = auth.uid()
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
         and (o.user_id = auth.uid()
              or (o.delivery_person_id in (select public.my_user_ids())
                  and o.status in ('out_for_delivery', 'delivered')))
    )
  );


-- ---------------------------------------------------------------- 5. transitions
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
  v_phones    int;
  v_is_admin  boolean := public.is_admin();
begin
  select status, delivery_person_id into v_current, v_assigned
    from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  -- A rider completes their own delivery, from any session on their number.
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
    raise exception 'Cannot move an order from % to %.', v_current, p_status
      using errcode = 'P0008';
  end if;

  if p_status = 'out_for_delivery' then
    if v_rider is null then
      -- Count PEOPLE, not profiles. Six sign-ins by one rider is still one rider.
      select count(distinct phone) into v_phones
        from public.profiles where role = 'delivery' and phone is not null;
      if v_phones = 1 then
        select id into v_rider from public.profiles
         where role = 'delivery' and phone is not null
         order by created_at desc limit 1;
      elsif v_phones = 0 then
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
