-- Новое ТЗ: liquid stock, Manufacturer, Surgery Type, OR time и контролируемые
-- изменения Finished surgery. Объём хранится в centi-ml: 1 ml = 100.

CREATE TABLE manufacturers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL CHECK (length(trim(name)) > 0),
  normalized_name TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  created_by_account_id INTEGER REFERENCES user_accounts(id)
);
CREATE UNIQUE INDEX ux_manufacturers_normalized_name ON manufacturers(normalized_name);
CREATE INDEX ix_manufacturers_name ON manufacturers(name);

CREATE TABLE surgery_types (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT    NOT NULL CHECK (length(trim(name)) > 0),
  normalized_name       TEXT    NOT NULL,
  status                TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  created_by_account_id INTEGER REFERENCES user_accounts(id),
  updated_by_account_id INTEGER REFERENCES user_accounts(id)
);
CREATE UNIQUE INDEX ux_surgery_types_normalized_name ON surgery_types(normalized_name);
CREATE INDEX ix_surgery_types_status_name ON surgery_types(status, name);

ALTER TABLE items ADD COLUMN tracking_method TEXT NOT NULL DEFAULT 'standard'
  CHECK (tracking_method IN ('standard', 'liquid'));
ALTER TABLE items ADD COLUMN manufacturer_id INTEGER REFERENCES manufacturers(id);
ALTER TABLE items ADD COLUMN liquid_volume_per_vial_centiml INTEGER
  CHECK (liquid_volume_per_vial_centiml IS NULL OR liquid_volume_per_vial_centiml > 0);
ALTER TABLE items ADD COLUMN liquid_unopened_vials INTEGER NOT NULL DEFAULT 0
  CHECK (liquid_unopened_vials >= 0);
ALTER TABLE items ADD COLUMN liquid_open_vial_centiml INTEGER NOT NULL DEFAULT 0
  CHECK (liquid_open_vial_centiml >= 0);
ALTER TABLE items ADD COLUMN liquid_low_stock_threshold_centiml INTEGER
  CHECK (liquid_low_stock_threshold_centiml IS NULL OR liquid_low_stock_threshold_centiml >= 0);
CREATE INDEX ix_items_manufacturer ON items(manufacturer_id);
CREATE INDEX ix_items_tracking_method ON items(tracking_method);

ALTER TABLE operations ADD COLUMN surgery_type_id INTEGER REFERENCES surgery_types(id);
ALTER TABLE operations ADD COLUMN surgery_type_name_snapshot TEXT;
ALTER TABLE operations ADD COLUMN or_started_at INTEGER;
ALTER TABLE operations ADD COLUMN or_ended_at INTEGER;
CREATE INDEX ix_operations_surgery_type ON operations(surgery_type_id, finished_at);
CREATE INDEX ix_operations_finished_at ON operations(status, finished_at);

-- PackItem получает отдельную величину liquid в centi-ml. Старые строки — standard.
ALTER TABLE pack_items RENAME TO pack_items_old;
CREATE TABLE pack_items (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  pack_id                INTEGER NOT NULL REFERENCES packs(id),
  item_id                INTEGER NOT NULL REFERENCES items(id),
  quantity               INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  liquid_amount_centiml  INTEGER CHECK (liquid_amount_centiml IS NULL OR liquid_amount_centiml > 0),
  CHECK ((quantity > 0 AND liquid_amount_centiml IS NULL) OR
         (quantity = 0 AND liquid_amount_centiml IS NOT NULL))
);
INSERT INTO pack_items(id, pack_id, item_id, quantity, liquid_amount_centiml)
SELECT id, pack_id, item_id, quantity, NULL FROM pack_items_old;
DROP TABLE pack_items_old;
CREATE UNIQUE INDEX ux_pack_items_pack_item ON pack_items(pack_id, item_id);
CREATE INDEX ix_pack_items_item ON pack_items(item_id);

-- Старый CHECK строки допускает только integer units; таблица перестраивается,
-- чтобы liquid line имела amount_used_centiml и независимый денежный snapshot.
ALTER TABLE operation_items RENAME TO operation_items_old;
CREATE TABLE operation_items (
  id                                INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id                      INTEGER NOT NULL REFERENCES operations(id),
  item_id                           INTEGER NOT NULL REFERENCES items(id),
  source_type                       TEXT    NOT NULL CHECK (source_type IN ('individual', 'pack')),
  source_pack_id                    INTEGER REFERENCES packs(id),
  item_name_snapshot                TEXT    NOT NULL,
  internal_code_snapshot            TEXT    NOT NULL,
  reference_number_snapshot         TEXT,
  manufacturer_name_snapshot        TEXT,
  tracking_method_snapshot          TEXT    NOT NULL DEFAULT 'standard'
    CHECK (tracking_method_snapshot IN ('standard', 'liquid')),
  unit_of_measurement_snapshot      TEXT    NOT NULL,
  quantity                          INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  amount_used_centiml               INTEGER CHECK (amount_used_centiml IS NULL OR amount_used_centiml > 0),
  unit_cost_snapshot_cents          INTEGER NOT NULL CHECK (unit_cost_snapshot_cents >= 0),
  applied_cost_per_measure_micros   INTEGER,
  line_total_cents                  INTEGER NOT NULL CHECK (line_total_cents >= 0),
  added_after_finish                INTEGER NOT NULL DEFAULT 0 CHECK (added_after_finish IN (0, 1)),
  added_after_finish_at             INTEGER,
  added_after_finish_by_account_id  INTEGER REFERENCES user_accounts(id),
  created_at                        INTEGER NOT NULL,
  updated_at                        INTEGER NOT NULL,
  CHECK (
    (tracking_method_snapshot = 'standard' AND quantity > 0 AND amount_used_centiml IS NULL AND
      line_total_cents = quantity * unit_cost_snapshot_cents) OR
    (tracking_method_snapshot = 'liquid' AND quantity = 0 AND amount_used_centiml > 0 AND
      applied_cost_per_measure_micros IS NOT NULL)
  ),
  CHECK (
    (source_type = 'pack' AND source_pack_id IS NOT NULL) OR
    (source_type = 'individual' AND source_pack_id IS NULL)
  )
);
INSERT INTO operation_items(
  id, operation_id, item_id, source_type, source_pack_id, item_name_snapshot,
  internal_code_snapshot, reference_number_snapshot, manufacturer_name_snapshot,
  tracking_method_snapshot, unit_of_measurement_snapshot, quantity,
  amount_used_centiml, unit_cost_snapshot_cents, applied_cost_per_measure_micros,
  line_total_cents, added_after_finish, created_at, updated_at
)
SELECT id, operation_id, item_id, source_type, source_pack_id, item_name_snapshot,
       internal_code_snapshot, reference_number_snapshot, NULL, 'standard',
       unit_of_measurement_snapshot, quantity, NULL, unit_cost_snapshot_cents,
       unit_cost_snapshot_cents * 10000, line_total_cents, 0, created_at, updated_at
FROM operation_items_old;
DROP TABLE operation_items_old;
CREATE INDEX ix_operation_items_agg
  ON operation_items(
    operation_id, item_id, source_type, COALESCE(source_pack_id, 0),
    tracking_method_snapshot, unit_cost_snapshot_cents,
    COALESCE(applied_cost_per_measure_micros, 0), added_after_finish
  );
CREATE INDEX ix_operation_items_operation ON operation_items(operation_id);
CREATE INDEX ix_operation_items_item ON operation_items(item_id);
CREATE INDEX ix_operation_items_pack ON operation_items(source_pack_id);

ALTER TABLE inventory_count_lines ADD COLUMN tracking_method_snapshot TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE inventory_count_lines ADD COLUMN expected_unopened_vials INTEGER;
ALTER TABLE inventory_count_lines ADD COLUMN counted_unopened_vials INTEGER;
ALTER TABLE inventory_count_lines ADD COLUMN expected_open_vial_centiml INTEGER;
ALTER TABLE inventory_count_lines ADD COLUMN counted_open_vial_centiml INTEGER;
ALTER TABLE inventory_count_lines ADD COLUMN final_unopened_vials INTEGER;
ALTER TABLE inventory_count_lines ADD COLUMN final_open_vial_centiml INTEGER;

CREATE TABLE liquid_inventory_movements (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id                    INTEGER NOT NULL REFERENCES items(id),
  movement_type              TEXT    NOT NULL,
  unopened_vials_delta       INTEGER NOT NULL,
  open_vial_centiml_delta    INTEGER NOT NULL,
  open_vial_centiml_before   INTEGER NOT NULL,
  open_vial_centiml_after    INTEGER NOT NULL,
  total_volume_centiml_delta INTEGER NOT NULL,
  operation_id               INTEGER REFERENCES operations(id),
  inventory_count_id         INTEGER REFERENCES inventory_counts(id),
  reason                     TEXT,
  vial_cost_at_receipt_cents INTEGER,
  idempotency_key            TEXT    NOT NULL,
  created_by_account_id      INTEGER REFERENCES user_accounts(id),
  created_at                 INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_liquid_movements_idempotency
  ON liquid_inventory_movements(idempotency_key);
CREATE INDEX ix_liquid_movements_item_created
  ON liquid_inventory_movements(item_id, created_at);
CREATE INDEX ix_liquid_movements_operation
  ON liquid_inventory_movements(operation_id);
CREATE INDEX ix_liquid_movements_count
  ON liquid_inventory_movements(inventory_count_id);

CREATE TABLE operation_cost_adjustments (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id             INTEGER NOT NULL REFERENCES operations(id),
  operation_item_id        INTEGER NOT NULL REFERENCES operation_items(id),
  old_cost_per_measure_micros INTEGER NOT NULL,
  new_cost_per_measure_micros INTEGER NOT NULL,
  old_line_total_cents     INTEGER NOT NULL,
  new_line_total_cents     INTEGER NOT NULL,
  reason                   TEXT,
  changed_by_account_id    INTEGER NOT NULL REFERENCES user_accounts(id),
  changed_at               INTEGER NOT NULL
);
CREATE INDEX ix_operation_cost_adjustments_operation
  ON operation_cost_adjustments(operation_id, changed_at);

CREATE TABLE operation_time_adjustments (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id          INTEGER NOT NULL REFERENCES operations(id),
  old_started_at        INTEGER,
  old_ended_at          INTEGER,
  new_started_at        INTEGER,
  new_ended_at          INTEGER,
  reason                TEXT,
  changed_by_account_id INTEGER NOT NULL REFERENCES user_accounts(id),
  changed_at            INTEGER NOT NULL
);
CREATE INDEX ix_operation_time_adjustments_operation
  ON operation_time_adjustments(operation_id, changed_at);

-- Фотографии не используются ни для items, ни для packs и удаляются полностью.
ALTER TABLE inventory_count_lines DROP COLUMN photo_url_snapshot;
ALTER TABLE items DROP COLUMN photo_url;
ALTER TABLE packs DROP COLUMN photo_url;
