-- Synthetic development identities only. Never run against a live database.
INSERT INTO users(id,phone) VALUES
 ('00000000-0000-4000-8000-000000000001','+21600000001'),
 ('00000000-0000-4000-8000-000000000002','+21600000002'),
 ('00000000-0000-4000-8000-000000000003','+21600000003'),
 ('00000000-0000-4000-8000-000000000004','+21600000004') ON CONFLICT(id) DO NOTHING;
INSERT INTO user_roles(user_id,role) VALUES
 ('00000000-0000-4000-8000-000000000001','customer'),
 ('00000000-0000-4000-8000-000000000002','merchant'),
 ('00000000-0000-4000-8000-000000000003','courier'),
 ('00000000-0000-4000-8000-000000000004','admin') ON CONFLICT DO NOTHING;
INSERT INTO stores(id,name_ar,name_fr,category,is_open,delivery_milli) VALUES
 ('10000000-0000-4000-8000-000000000001','مذاق نابل','Saveurs de Nabeul','restaurants',true,3000),
 ('10000000-0000-4000-8000-000000000002','سوق الحي','Marché du quartier','groceries',true,2500) ON CONFLICT(id) DO NOTHING;
INSERT INTO store_members(store_id,user_id) VALUES('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002') ON CONFLICT DO NOTHING;
INSERT INTO courier_profiles(user_id,verified,available) VALUES('00000000-0000-4000-8000-000000000003',true,true) ON CONFLICT(user_id) DO NOTHING;
INSERT INTO products(id,store_id,name_ar,name_fr,price_milli) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','كسكسي بالخضار','Couscous aux légumes',14500),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','سلاطة مشوية','Salade méchouia',6500),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','سلة خضار','Panier de légumes',12000) ON CONFLICT(id) DO NOTHING;
-- Nabeul reference geometry and store links are seeded by migrate.mjs from the pinned GeoJSON.
INSERT INTO addresses(id,user_id,label,address_text,latitude,longitude) VALUES('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','عنوان اختبار في نابل','عنوان وهمي لاختبار التوصيل في نابل',36.46,10.73) ON CONFLICT(id) DO NOTHING;
