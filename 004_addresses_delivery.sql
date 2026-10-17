BEGIN;
ALTER TABLE addresses ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE addresses ADD COLUMN archived boolean NOT NULL DEFAULT false;
UPDATE addresses SET archived=true WHERE latitude IS NULL OR longitude IS NULL;
ALTER TABLE addresses ADD CONSTRAINT active_address_coordinates CHECK(archived OR (latitude IS NOT NULL AND longitude IS NOT NULL));
CREATE INDEX addresses_user_active ON addresses(user_id) WHERE NOT archived;
CREATE TABLE service_zones(id text PRIMARY KEY,name_ar text NOT NULL,name_fr text NOT NULL,south numeric(9,6) NOT NULL,north numeric(9,6) NOT NULL,west numeric(9,6) NOT NULL,east numeric(9,6) NOT NULL,geometry jsonb NOT NULL,enabled boolean NOT NULL DEFAULT false,CHECK(south>=-90 AND north<=90 AND south<north),CHECK(west>=-180 AND east<=180 AND west<east),CHECK(geometry->>'type' IN ('Polygon','MultiPolygon')));
CREATE TABLE store_service_zones(store_id uuid REFERENCES stores(id),zone_id text REFERENCES service_zones(id),PRIMARY KEY(store_id,zone_id));
COMMIT;
