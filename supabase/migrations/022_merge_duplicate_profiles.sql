-- Sabji · collapse the duplicate profiles one phone number accumulated
--
-- WHY THERE ARE MANY
-- Dev sign-in (VITE_DEV_STATIC_OTP) uses Supabase anonymous auth, which mints
-- a NEW auth user on every sign-in — a different browser, a cleared cache, a
-- private window, each makes another. sync_my_phone() then stamps the same
-- number on each new profile. 016 and 018 made everything key off the phone so
-- this was invisible in use, but the rows kept piling up.
--
-- WHAT THIS DOES
-- For each phone, keep ONE profile — preferring one that has a name, then the
-- oldest — repoint everything the others own onto it, and delete the rest
-- (including their auth.users rows, which is what stops them coming back).
--
-- ANYONE SIGNED IN AS A DELETED PROFILE IS SIGNED OUT. They sign in again and
-- land on the keeper. Nothing they own is lost; it has already been moved.
--
-- This does not stop NEW duplicates appearing — only real phone OTP does that,
-- because Supabase then reuses the user for a number. See the README.

do $$
declare
  v_keep  uuid;
  v_dupes uuid[];
  v_phone text;
  v_total int := 0;
begin
  for v_phone in
    select phone from public.profiles
     where phone is not null
     group by phone having count(*) > 1
  loop
    -- Prefer a profile with a name, then the oldest.
    select id into v_keep
      from public.profiles
     where phone = v_phone
     order by (nullif(full_name, '') is null), created_at
     limit 1;

    select array_agg(id) into v_dupes
      from public.profiles
     where phone = v_phone and id <> v_keep;

    if v_dupes is null then continue; end if;

    -- Move everything the duplicates own onto the keeper.
    update public.addresses          set user_id = v_keep where user_id = any(v_dupes);
    update public.orders             set user_id = v_keep where user_id = any(v_dupes);
    update public.orders             set delivery_person_id = v_keep where delivery_person_id = any(v_dupes);
    update public.promo_redemptions  set user_id = v_keep where user_id = any(v_dupes);
    update public.order_status_history set changed_by = v_keep where changed_by = any(v_dupes);
    update public.orders             set payment_confirmed_by = v_keep where payment_confirmed_by = any(v_dupes);
    update public.tenants            set created_by = v_keep where created_by = any(v_dupes);

    -- wa_contacts.user_id is one row per phone, so just point it at the keeper.
    update public.wa_contacts set user_id = v_keep where user_id = any(v_dupes);

    -- Carry a name over if the keeper has none.
    update public.profiles p
       set full_name = coalesce(nullif(p.full_name, ''),
             (select nullif(d.full_name, '') from public.profiles d
               where d.id = any(v_dupes) and nullif(d.full_name, '') is not null limit 1), '')
     where p.id = v_keep;

    -- Deleting the auth user cascades to its profile.
    delete from auth.users where id = any(v_dupes);

    v_total := v_total + array_length(v_dupes, 1);
    raise notice 'phone % → kept %, removed % duplicate(s)', v_phone, v_keep, array_length(v_dupes, 1);
  end loop;

  raise notice 'Done. % duplicate profile(s) removed.', v_total;
end $$;

-- DELIBERATELY NOT ADDING a unique index on profiles.phone.
--
-- It looks like the obvious guard, but it breaks the app: anonymous sign-in
-- always creates a new user, so the SECOND device to sign in with a number
-- would be refused the phone, get no role from the allowlist, and an admin
-- would be locked out of their own shop on their own phone.
--
-- Duplicates are harmless in use — 016 and 018 made roles, deliveries,
-- addresses, orders and promo usage all key off the number. They are only
-- clutter, and this script clears it.
--
-- The permanent fix is real phone OTP, where Supabase reuses the user for a
-- number and no duplicate is ever created. Supabase's Test OTP gives that
-- without an SMS bill: Authentication -> Sign In / Providers -> Phone ->
-- Test OTP, add the number and a fixed code, then drop VITE_DEV_STATIC_OTP.
-- The app already calls signInWithOtp whenever that variable is absent.
