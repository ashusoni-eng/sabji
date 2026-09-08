-- Sabji · make the profile trigger work for dev sign-in
--
-- Dev sign-in (VITE_DEV_STATIC_OTP) creates the account through email auth, so
-- auth.users.phone is null and the number arrives in raw_user_meta_data instead.
-- Real phone-OTP sign-in still populates auth.users.phone, so this handles both.
--
-- Safe to run on an existing database; it only replaces the function.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, phone, full_name)
  values (
    new.id,
    coalesce(new.phone, new.raw_user_meta_data->>'phone'),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Backfill anyone who signed up before this ran.
update public.profiles p
   set phone = coalesce(u.phone, u.raw_user_meta_data->>'phone')
  from auth.users u
 where u.id = p.id and p.phone is null;
