BEGIN;
CREATE UNIQUE INDEX courier_one_active_delivery ON orders(courier_id) WHERE courier_id IS NOT NULL AND status IN ('assigned','picked_up');
ALTER TABLE order_events ADD CONSTRAINT order_events_status_check CHECK(status IN ('placed','accepted','preparing','ready','assigned','picked_up','delivered','cancelled'));
COMMIT;
