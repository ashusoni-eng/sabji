-- Sabji · close a privilege-escalation hole and make admin grantable by phone
--
-- THE BUG: 002_rls.sql claimed "is_admin is deliberately NOT settable through
-- the API". That was wrong. Postgres row-level security filters ROWS, not
-- COLUMNS, so the "update own profile" policy happily allowed:
--
--   PATCH /rest/v1/profiles?id=eq.<own-id>   {"is_admin": true}
--
-- Any signed-in customer could promote themselves to shop admin and then edit
-- prices, read every order, and change delivery settings.
--
-- THE FIX: column-level GRANTs, which are the right Postgres mechanism for
-- this. A customer may update only their own name and phone; is_admin is not
-- writable through PostgREST at all, by anyone.

revoke update on public.profiles from authenticated, anon;
grant  update (full_name, phone) on public.profiles to authenticated;

-- ---------------------------------------------------------------- admin list
-- Admin is granted to a PHONE NUMBER, not to a user row. That matters because
-- a new sign-in (new device, cleared storage, or dev anonymous auth) creates a
-- fresh user; keying off the number means the shop owner stays admin instead of
-- having to be re-promoted by hand each time.
create table if not exists public.admin_phones (
  phone      text primary key,          -- E.164, e.g. +919876543210
  note       text not null default '',
  created_at timestamptz not null default now()
);

-- No policies are defined, so with RLS on, this table is invisible and
-- unwritable through the API. Only the SQL editor / service role can touch it.
alter table public.admin_phones enable row level security;

-- Keep profiles.is_admin in step with the allowlist. The client reads that
-- column to decide whether to show the Admin tab.
create or replace function public.sync_admin_from_allowlist()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.phone is not null
     and exists (select 1 from public.admin_phones a where a.phone = new.phone) then
    new.is_admin := true;
  elsif auth.uid() is not null then
    -- An API caller can never raise their own privileges; only the allowlist
    -- above or a direct SQL update (where auth.uid() is null) can.
    new.is_admin := coalesce(old.is_admin, false);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_admin on public.profiles;
create trigger profiles_sync_admin
  before insert or update on public.profiles
  for each row execute function public.sync_admin_from_allowlist();

-- Belt and braces: resolve admin from either source at check time, so the
-- allowlist works even for a row the trigger has not touched yet.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.is_admin
            or exists (select 1 from public.admin_phones a where a.phone = p.phone))
  );
$$;

-- ---------------------------------------------------------------- clean up
-- Drop any admin flag that was set through the API before this migration.
-- Numbers in admin_phones are re-applied on the next profile write, and
-- is_admin() consults the allowlist directly regardless.
update public.profiles p
   set is_admin = false
 where p.is_admin
   and not exists (select 1 from public.admin_phones a where a.phone = p.phone);


-- ================================================================
-- TO MAKE YOURSELF ADMIN, run this with your own number:
--
--   insert into public.admin_phones (phone, note)
--   values ('+919522272781', 'shop owner')
--   on conflict (phone) do nothing;
--
--   update public.profiles set phone = phone where phone = '+919522272781';
--
-- The second line is a no-op write that fires the trigger and flips is_admin
-- on any account already signed in with that number. Then reload the app.
-- ================================================================
