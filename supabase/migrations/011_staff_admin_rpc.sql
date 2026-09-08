-- Sabji · admin-only management of the staff allowlist
--
-- staff_phones has RLS enabled with no policies, so it is invisible through
-- PostgREST. These SECURITY DEFINER functions are the only way in, and each one
-- checks is_admin() before doing anything.

create or replace function public.admin_list_staff()
returns table (phone text, role public.user_role, name text, note text,
               has_account boolean, full_name text)
language sql stable security definer set search_path = public
as $$
  select s.phone, s.role, s.name, s.note,
         (p.id is not null) as has_account,
         coalesce(p.full_name, '') as full_name
    from public.staff_phones s
    left join public.profiles p on p.phone = s.phone
   where public.is_admin()
   order by s.role, s.name, s.phone;
$$;

create or replace function public.admin_set_staff(
  p_phone text, p_role public.user_role, p_name text default ''
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter the number in international form, e.g. +919876543210.'
      using errcode = 'P0014';
  end if;

  insert into public.staff_phones (phone, role, name)
  values (p_phone, p_role, coalesce(p_name, ''))
  on conflict (phone) do update set role = excluded.role, name = excluded.name;

  -- Apply immediately to an account that already exists on that number.
  update public.profiles set phone = phone where phone = p_phone;
end;
$$;

create or replace function public.admin_remove_staff(p_phone text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  -- Never let the last admin remove themselves and lock the shop out.
  if (select role from public.staff_phones where phone = p_phone) = 'admin'
     and (select count(*) from public.staff_phones where role = 'admin') <= 1 then
    raise exception 'This is the only admin. Add another before removing this one.'
      using errcode = 'P0015';
  end if;

  delete from public.staff_phones where phone = p_phone;
  update public.profiles set role = 'customer', is_admin = false where phone = p_phone;
end;
$$;

grant execute on function public.admin_list_staff() to authenticated;
grant execute on function public.admin_set_staff(text, public.user_role, text) to authenticated;
grant execute on function public.admin_remove_staff(text) to authenticated;
