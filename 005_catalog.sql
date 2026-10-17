BEGIN;
CREATE TABLE product_create_requests(
 store_id uuid NOT NULL REFERENCES stores(id),
 request_id uuid NOT NULL,
 request_hash text NOT NULL,
 product_id uuid NOT NULL,
 PRIMARY KEY(store_id,request_id),
 FOREIGN KEY(product_id,store_id) REFERENCES products(id,store_id)
);
ALTER TABLE order_items ADD COLUMN name_fr_snapshot text;
COMMIT;
