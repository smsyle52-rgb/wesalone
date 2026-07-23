-- Custom SQL migration file, put your code below! --

-- Seeds the 3 real point bundles from Wesal One's original catalog
-- (artifacts/api-server/src/lib/seed.ts in the reference project). Small
-- fixed ids (1/2/3) are safe here: this table is brand new and the app's
-- Snowflake id generator never produces values this small.
INSERT INTO "PointTopupProduct" ("id", "slug", "nameAr", "nameEn", "descriptionAr", "descriptionEn", "points", "priceCents", "currency", "sortOrder")
VALUES
  (1, 'topup_5k', 'شحنة صغيرة', 'Small Bundle', NULL, NULL, 5000, 700, 'USD', 10),
  (2, 'topup_20k', 'شحنة مرنة', 'Flex Bundle', NULL, NULL, 20000, 2500, 'USD', 20),
  (3, 'topup_50k', 'شحنة كبيرة', 'Large Bundle', NULL, NULL, 50000, 5900, 'USD', 30)
ON CONFLICT ("id") DO NOTHING;
