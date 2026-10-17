BEGIN;
ALTER TABLE stores ADD COLUMN enabled boolean NOT NULL DEFAULT true;
ALTER TABLE stores ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE products ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE courier_profiles ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
CREATE TABLE operations_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL,
 resource text NOT NULL CHECK(resource IN ('store','product','courier')),
 target_id uuid NOT NULL,
 before_snapshot jsonb NOT NULL,
 after_snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operations_audit_created ON operations_audit(created_at DESC,id DESC);
COMMIT;
