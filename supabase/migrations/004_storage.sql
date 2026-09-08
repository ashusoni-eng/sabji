-- Sabji · product image storage
-- Public read (product photos are public), admin-only write.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images', 'product-images', true, 5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

create policy "public reads product images" on storage.objects
  for select using (bucket_id = 'product-images');

create policy "admin uploads product images" on storage.objects
  for insert with check (bucket_id = 'product-images' and public.is_admin());

create policy "admin updates product images" on storage.objects
  for update using (bucket_id = 'product-images' and public.is_admin());

create policy "admin deletes product images" on storage.objects
  for delete using (bucket_id = 'product-images' and public.is_admin());
