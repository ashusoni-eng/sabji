-- Sabji · close a phone-based privilege escalation, and make staff removal stick
--
-- BUG 1 (critical) — a customer could grant themselves admin.
-- 008 grants the client UPDATE on profiles.phone, and the role trigger derives
-- the role from staff_phones by matching on that same column. So:
--
--   UPDATE profiles SET phone = '<the shop owner's number>' WHERE id = <me>
--
-- made the caller an admin. Verified: role went customer -> admin and
-- is_admin() returned true. The number was never checked against the one the
-- account actually signed in with.
--
-- Fix: the client can no longer write `phone` at all. The profile's number is
-- copied from auth.users by sync_my_phone() below, and auth.users.phone is what
-- the OTP actually verified.
--
-- BUG 2 — removing someone from staff left their role in place.
-- The trigger preserved the old role on any API-driven write, so deleting the
-- staff_phones row demoted nobody. Fix: for API writes the allowlist is the
-- ONLY source of a role, so losing the entry means losing the role.

-- ---------------------------------------------------------------- 1. columns
revoke update on public.profiles from authenticated, anon;
grant  update (full_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------- 2. trigger
create or replace function public.sync_role_from_allowlist()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_role public.user_role;
begin
  select s.role into v_role from public.staff_phones s where s.phone = new.phone;

  if auth.uid() is null then
    -- Direct SQL (the SQL editor or the service role). The allowlist still wins
    -- when it has an entry; otherwise honour what is being written, so the very
    -- first admin can be created by hand.
    new.role := coalesce(v_role, new.role, 'customer');
  else
    -- Anything reaching us through the API: staff_phones is the only source of
    -- a role. No entry means no role, which is what makes removal take effect.
    new.role := coalesce(v_role, 'customer');
  end if;

  new.is_admin := (new.role = 'admin');
  return new;
end;
$$;

drop trigger if exists profiles_sync_role on public.profiles;
create trigger profiles_sync_role
  before insert or update on public.profiles
  for each row execute function public.sync_role_from_allowlist();

-- ---------------------------------------------------------------- 3. phone
-- The only way a profile's number gets set. It is copied from auth.users, which
-- is what the OTP verified — never from anything the caller passes in.
--
-- With the dev sign-in (VITE_DEV_STATIC_OTP) the number comes from user
-- metadata instead and is therefore unverified. That is the documented cost of
-- skipping SMS; connect a real provider and it becomes verified again.
create or replace function public.sync_my_phone()
returns text
language plpgsql security definer set search_path = public
as $$
declare v_phone text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select coalesce(u.phone, u.raw_user_meta_data->>'phone')
    into v_phone
    from auth.users u
   where u.id = auth.uid();

  update public.profiles set phone = v_phone where id = auth.uid();
  return v_phone;
end;
$$;

grant execute on function public.sync_my_phone() to authenticated;

-- ---------------------------------------------------------------- 4. repair
-- Undo any escalation that already happened, then re-derive every role from
-- the allowlist so the two are back in step.
update public.profiles p
   set phone = coalesce(u.phone, u.raw_user_meta_data->>'phone')
  from auth.users u
 where u.id = p.id
   and p.phone is distinct from coalesce(u.phone, u.raw_user_meta_data->>'phone');

update public.profiles p
   set role = coalesce((select s.role from public.staff_phones s where s.phone = p.phone), 'customer'),
       is_admin = coalesce((select s.role = 'admin' from public.staff_phones s where s.phone = p.phone), false);
