-- Sabji · seed data
-- The fifteen products that were previously hard-coded into App.jsx, now
-- real rows with real variants. image_url points at the original artwork;
-- replace each one from the admin panel with your own photograph.

-- Everything seeds into the first tenant. 019 creates one if none exists.
insert into public.categories (tenant_id, name, slug, sort_order)
select t.id, c.name, c.slug, c.sort_order
  from (select id from public.tenants order by created_at limit 1) t,
       (values ('Fruits','fruits',1), ('Vegetables','vegetables',2),
               ('Exotic','exotic',3), ('Organic','organic',4)) as c(name, slug, sort_order)
on conflict do nothing;

do $$ declare v_p uuid; begin
  insert into public.products (tenant_id, category_id, name, description, badge, sort_order, image_url)
  select tenant_id, id, 'Kela (Banana)', 'Ripe and sweet, picked this morning.', 'Fresh', 1, 'https://lh3.googleusercontent.com/aida-public/AB6AXuD7CT7ONMgvda6syv8toj5z16a0miLZAfj8xa4QQ4dkzR-TqbeSqV6dt-eZF8KHaxi7bBUQfZ63NwJRgm-BNAKAATGp8VEh7M_OqDjgOBaidy3NNa1zcMh9LScLFJoxDpJjDnRPEpie18S_N9xGuKLQeMBh0ubwrxhzIyoyEullgchIXYK7r_WawVs56h-PNiJNTgUocKk3WGLY1V-hWNR6uMuOwl3SRXUaYK0u6M87bzPEcAS9PibukTDY35iJgswFi2EFBMN2acw'
    from public.categories where slug = 'fruits'
  returning id into v_p;
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Default', '12 pc', 7000, 0);
end $$;

do $$ declare v_p uuid; begin
  insert into public.products (tenant_id, category_id, name, description, badge, sort_order, image_url)
  select tenant_id, id, 'Tarbooj (Watermelon)', 'Deep red inside, cools you down.', null, 2, 'https://lh3.googleusercontent.com/aida-public/AB6AXuCSlqn0u9UrzgOgJ5b_q19ZgXfYwDF4CXcEVWMSoOiq_AILcdcDniug7UxHMf5EqrcitCJtVK-RO_b23VWnVGQxAUtVjXf2nYnpBOMcysWLmh6Np385lubHzNvOQZ1lvbDWgd1dKB8YE00HUX1CSwsntILQSd4DlrhejapTEqJwoUiXiCZ1YETYSzvqEZiUPYYEZeqQCea39rVR9JFotqh-VRoBOyeM7n4vX7G8INpi0Vy3YgZW-pSK1BEYtMbn5x3sVBPsAwSroNk'
    from public.categories where slug = 'fruits'
  returning id into v_p;
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Default', '1 kg', 3000, 0);
end $$;

do $$ declare v_p uuid; begin
  insert into public.products (tenant_id, category_id, name, description, badge, sort_order, image_url)
  select tenant_id, id, 'Kharbuja (Muskmelon)', 'Fragrant and juicy.', null, 3, 'https://lh3.googleusercontent.com/aida-public/AB6AXuAMnJDVzq6WAL-XoTOs60IlT8Mp4Bk89r7DLUk3icYGsPzS8240kTmZQWHsqBtLFxnglXhC2AYSRyYhBGKmbdJ8lHsWa9xvi3GH132YxlNB8Lv1g0dSu3DOzyAsF2DCd0PtWE1dZCvQmq7x_wgP49nvmrF4iOBtKZh5drBZovnOGIJ0N609fLN3eKW_bkh23o3QyO-Fwt1_XQuFE1veNMP_8-HoZ0mGDWM1a3OvFaosDSnRAyZRcz7bIA_QV9_jl4OzjSTwyHKgX2c'
    from public.categories where slug = 'fruits'
  returning id into v_p;
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Default', '1 kg', 7000, 0);
end $$;

do $$ declare v_p uuid; begin
  insert into public.products (tenant_id, category_id, name, description, badge, sort_order, image_url)
  select tenant_id, id, 'Anar (Pomegranate)', 'Heavy, deep-red arils.', 'Rich', 4, 'https://lh3.googleusercontent.com/aida-public/AB6AXuA7NZRFIlXdljG86kQAMGPpporxrynR2KMEgjIJQerLwr9Pm7Sih03jW5SOj-Wz2Nmj522DqZNrCCagxho01jUL9PjQwccvoxTSoO8PgEXaMJ8aYWW9-s9ABVh6O80eEkqqXNBa6LoHo7ACBsI9Xtu4b3KamMQSRwdfOYEL57xQEb-NamHN-yR5Iis5elHc66Cs5Gw_9ZGz0EPhzLbq8aKwwn3koyY-b6EU2WSJ9kklCeHYa71kpkDn1ipdEXAdylGwHO3Mod9oju8'
    from public.categories where slug = 'fruits'
  returning id into v_p;
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Default', '1 kg', 20000, 0);
end $$;

do $$ declare v_p uuid; begin
  insert into public.products (tenant_id, category_id, name, description, badge, sort_order, image_url)
  select tenant_id, id, 'Aam (Mango)', 'Premium Alphonso quality.', 'Season''s Best', 5, 'https://lh3.googleusercontent.com/aida-public/AB6AXuC1I8JinzWIL01lHe6ez5VO8qAkLpw5MwcdulVexThVcW2ZTRu8kAy1vCzMxveczcMnW0C0JSASuVoPNkYR990CwGVjlbjaoWjkIXLIMQdjuEXCTOL_SziOWtjO4C2Vwg49PlEmt7Tp7BwSY5tFUu43N69FAIOcqJs26FHA_D1uHj6i1g_nFwXGLnydNs0PPMOXoxe_zAYIp8t9woUsM5J3uagubHYyWAW2Y9JyZdrucBs1IttJwHVPs6yQu7TghG8zmkYWzHXsLiI'
    from public.categories where slug = 'fruits'
  returning id into v_p;
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Default', '1 kg', 20000, 0);
end $$;

do $$ declare v_p uuid; begin
  insert into public.products (tenant_id, category_id, name, description, badge, sort_order, image_url)
  select tenant_id, id, 'Bhindi (Ladyfinger)', 'Tender, snaps clean.', null, 6, 'https://lh3.googleusercontent.com/aida-public/AB6AXuCdGCGPOLjqMRjoLhc3YreNcbnzcpDgDVbV6Fb_JkCfFU67s8Zj_fzIW_1Py_YFUEM_SvKPVJZ70JwH598jBD6DogpW3e2KxM5kFUdLDi0QynkTzZciPOZcX-DDVc5Znp0uoAkplUqewvgNpw2u02A2PomfR2H4zIXE7LG5oDIJHNkOCE2JQFI4BAL5iUBmMJ1rOjzsm-rvL_Ai79fyChvph5TpSboU-R0Yl754LXmBae1ttiwyfvdD9kc7-LrnNkGrVn23AlbNCB4'
    from public.categories where slug = 'vegetables'
  returning id into v_p;
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Default', '1 kg', 10000, 0);
end $$;

do $$ declare v_p uuid; begin
  insert into public.products (tenant_id, category_id, name, description, badge, sort_order, image_url)
  select tenant_id, id, 'Tamatar (Tomato)', 'Hybrid for curries, desi for chutney.', null, 7, 'https://lh3.googleusercontent.com/aida-public/AB6AXuA46N76KQGTOyBwyRKF6YznvPvE9p4yLVbuKUendV78XS0SDKFHUv08PIYC_DLkCAIob2KdxVsFEqb6xPqqeTIs22tjcsJ5qBc6WgQo9UcmFB-a4pn7bqEyVrYvviQQglxyENwqYh0Afppl2TjIUv1WqHHAGcZU4Sv_GaAT9QPaPK3w2uBe2_AWf_cGxRmNVbyVah_PFk3e6550dL-R4_W4xzMP4RQNW804iDYT8J8aD1j4Pf5As739ggOYEitVR_Tr6K0frMuQVUk'
    from public.categories where slug = 'vegetables'
  returning id into v_p;
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Hybrid', '1 kg', 3000, 0);
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Desi', '2 kg', 5000, 1);
end $$;

do $$ declare v_p uuid; begin
  insert into public.products (tenant_id, category_id, name, description, badge, sort_order, image_url)
  select tenant_id, id, 'Peyaj (Onion)', 'Firm with dry skin. Bulk rate available.', null, 8, 'https://lh3.googleusercontent.com/aida-public/AB6AXuD7rlPFAEVwmwHxaMkSc9egEU8KkUC49ZHbEgMvNtnchI0nV5mGGtGXkS_4cF2cl19pvM1AM48tZAZszzdxQ_sSsFfn2_tVHIlFhfOkQMPoh8cy3cvkSCp8dpsWERneHBQWhNrBjMz0YDPyVFrGTTRYqanSmrBcyeEAxgDy_61rSBok20uprVyHCzTO57UCMTj_tv8n6-hF86OA_rfiEmSxVKTn674GhPJd6zmUoFoyGVvEyEOKLzk7uwy98H1H7I9HjkKhAr5jhR4'
    from public.categories where slug = 'vegetables'
  returning id into v_p;
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Loose', '1 kg', 3000, 0);
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Bora', '5 kg', 13000, 1);
end $$;

do $$ declare v_p uuid; begin
  insert into public.products (tenant_id, category_id, name, description, badge, sort_order, image_url)
  select tenant_id, id, 'Aalu (Potato)', 'Fresh from the field. Bulk rate available.', null, 9, 'https://lh3.googleusercontent.com/aida-public/AB6AXuA8XMIHqrEy-hOtBabAbkZilX1xXa8woUq7m0ATLN-Y82HGpLOW9AhZJUkmzL6zGLmyw22l2vexovFTOyFURF80_sF-GI_4t0e6QbLRF5SyPngX32LL0EFhZTowe34RliZ2QtnL7zSL1cRopa5y7cfzfqHjuqB-QQwyEaN12bH9DKLxYwrFTejqQEsKyuKHIGNm9twYqkIC0uzIwjGWPZCsZ0UThLYLkcvsy9GOeiRLYjcF-oMfn-g6vQHGYMXWF3GHRBjUdJDTSS8'
    from public.categories where slug = 'vegetables'
  returning id into v_p;
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Loose', '1 kg', 1000, 0);
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Bora', '5 kg', 7000, 1);
end $$;

do $$ declare v_p uuid; begin
  insert into public.products (tenant_id, category_id, name, description, badge, sort_order, image_url)
  select tenant_id, id, 'Simla merch', 'Shiny green capsicum.', null, 10, 'https://lh3.googleusercontent.com/aida-public/AB6AXuDlj84pVTRVlrS0SlhfFRhIHaBy_DgegPRmaq-quPFptkteWIr3TB9F1QMDCql3WLA8DT6ir69-OUzMeIse7rhkSFBNSDyaArgP8Il-2jZG9X-NqgzWiVYdX1jJp6dqqA1nRDv1If7EyOBSnR06LLWQP2RHVkw4ifW201J_WMp1JvVmBQpDQ76hl1-V9J0W7FOnPCJtImcdEAxTWYOuQ2hukfqqUpNgKURCPs4bIKYTqFM3RBO2WX_ceEwbj_dlzzlXQoHbsRqCoPQ'
    from public.categories where slug = 'vegetables'
  returning id into v_p;
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Default', '1 kg', 8000, 0);
end $$;

do $$ declare v_p uuid; begin
  insert into public.products (tenant_id, category_id, name, description, badge, sort_order, image_url)
  select tenant_id, id, 'Gajar (Carrot)', 'Orange for daily, red for halwa.', null, 11, 'https://lh3.googleusercontent.com/aida-public/AB6AXuAPR0gNO_1zYwycoO11hJvu6dgScpjSZTABwaB-iuOrf83VsMrEhfapbk6tbdM6p83iayK13yTe5IygiyVhgf3b76XKpK9oFlEiDEc64xxf6YXpgZmzocfkBIIQrj1lXZy4chZJyWde1Yse3WVVXwwfV2keSBry2ZVkAfzVQZjF8UVK-nyHSirRYVpQeyDimWTF7uFUsod4wXFuYuj8znwKPk8kqqgin7H2Vze72ma_0T0A67o0jums4fpZ13rFuEEP-kL99buUNSk'
    from public.categories where slug = 'vegetables'
  returning id into v_p;
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Orange', '1 kg', 4000, 0);
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Red', '1 kg', 6000, 1);
end $$;

do $$ declare v_p uuid; begin
  insert into public.products (tenant_id, category_id, name, description, badge, sort_order, image_url)
  select tenant_id, id, 'Kiwi Special', 'Imported, high in vitamin C.', null, 12, 'https://lh3.googleusercontent.com/aida-public/AB6AXuDSQUchlhm9eDUq9ybmhNcQHUeLzTaVDsMbgbfiqbTIbEj8sV0VT86dV2XfoIS81fAgvdJSTa-Eg0huh1B28dLLYZtK6aIW87RVstsPw7SBw1pMxTJPdpU4SdxFPDVXXV2W11ftIEXU1l4zNKn8DYzghTdxtfvGqUU0ha-5rrLAR0LImxNKg0tfI_KavqjE4qnTizj-NSRJE648yjAKh3TcjmT_kPv4EwZdNqSPc8mI_YzRKeOwnKP_jtfeo-gqJlPmvnwH4_u2_yg'
    from public.categories where slug = 'exotic'
  returning id into v_p;
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Default', '1 pkt', 12000, 0);
end $$;

do $$ declare v_p uuid; begin
  insert into public.products (tenant_id, category_id, name, description, badge, sort_order, image_url)
  select tenant_id, id, 'Amrud', 'Crisp guava, lightly sweet.', null, 13, 'https://lh3.googleusercontent.com/aida-public/AB6AXuAhgYHd5FG7mPqpZcYSBwDXIqy_eyp3V6chXCR3SZ3lop2EaCn6CVAECaZA8OHdWEa6ZWZVjL-rxmt-I8UGP0BFUHf0Y5pBVmNXKISE9AqPecmyp2uyyHXh4fY7wnbaePl0lcvA_sRzUu7lJQIilFh5BO-zl14fiQKUPjrlaAvxMrG8yD4AtkwBYAJ_MSkgJEqMXu09qPuTamUpCW8j7NaSHqVS2G888YN9sBhLEOnkAOtR0_wxDpV_fkRDYRdryHvvfJe7Qf8uibg'
    from public.categories where slug = 'fruits'
  returning id into v_p;
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Default', '1 kg', 12000, 0);
end $$;

do $$ declare v_p uuid; begin
  insert into public.products (tenant_id, category_id, name, description, badge, sort_order, image_url)
  select tenant_id, id, 'Chikoo', 'Soft sapodilla, honey sweet.', null, 14, 'https://lh3.googleusercontent.com/aida-public/AB6AXuDfu1JsVQreEOdMtkjXvdwRGb6i7XOO3m_3obisLq0pZm8vIU9iolVuaVg4LHZXjMfF93XSUcA3yY-XvSYoeS-HmmZOLj2DIh9cqPnziAiBFQcyf9_kcVELo2Lb29NxjeV1K57zqGQ9YXQGG1Ql75DgY7wyr8GsR8LrBaqnriadJH-dVVXPh0ZNN0R_404cdLbVHAqtJgltZAzxnDGLzmJQVcf_wa59m5KGlr2JVgvvHZaAvYoppUIty8sE1V9qbFjQoZCAS-auTrs'
    from public.categories where slug = 'fruits'
  returning id into v_p;
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Default', '1 kg', 10000, 0);
end $$;

do $$ declare v_p uuid; begin
  insert into public.products (tenant_id, category_id, name, description, badge, sort_order, image_url)
  select tenant_id, id, 'Pineapple', 'Whole, ripe and tangy.', null, 15, 'https://lh3.googleusercontent.com/aida-public/AB6AXuApxaS_-PZ4_m3ayuO5CEmxHkPYIWtWggMyrre2s7d1HBQCi01J9Kz5L_1l08Sm8eGk3VWOF7lt13H6sGZcrIc9mYEbV1JpPUZL1XG3d8U28Qa0H7-Qe7XcdboD_AODCQL5L8QvB2BD60D5Uub2-5bXwP0xtCFADD508HhtEpD8-Sp5w-LHt_upTtdp35cmXYLcTRtqI0mRETfA-NCxguoCDoBgqKlb3GOk-ONszTi2ZOUDBPb1tLx1Stt7A4Ls22AhXFbs2tmc8Yo'
    from public.categories where slug = 'fruits'
  returning id into v_p;
  insert into public.product_variants (product_id, label, unit, price_paise, sort_order)
  values (v_p, 'Default', '1 pc', 10000, 0);
end $$;
