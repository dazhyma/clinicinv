-- Новая навигация не меняет учётное ядро, но подробные исторические отчёты
-- требуют самостоятельных снимков и исполнителей. Старые тестовые строки
-- получают детерминированный номер из id; неизвестные исторические исполнители
-- остаются NULL.

ALTER TABLE inventory_counts ADD COLUMN internal_code TEXT;
ALTER TABLE inventory_counts ADD COLUMN created_by_role TEXT;
ALTER TABLE inventory_counts ADD COLUMN completed_by_account_id INTEGER REFERENCES user_accounts(id);
ALTER TABLE inventory_counts ADD COLUMN completed_by_role TEXT;

UPDATE inventory_counts
SET internal_code = 'INV-' || printf('%06d', id)
WHERE internal_code IS NULL;

CREATE UNIQUE INDEX ux_inventory_counts_internal_code
  ON inventory_counts (internal_code);
CREATE INDEX ix_inventory_counts_applied_at
  ON inventory_counts (status, applied_at);
-- В системе может существовать только один общий активный черновик.
-- Если в старых тестовых данных их несколько, сохраняем только последний.
UPDATE inventory_counts
SET status = 'cancelled',
    cancelled_at = COALESCE(cancelled_at, updated_at)
WHERE status = 'draft'
  AND id <> (SELECT MAX(id) FROM inventory_counts WHERE status = 'draft');
CREATE UNIQUE INDEX ux_inventory_counts_single_draft
  ON inventory_counts (status)
  WHERE status = 'draft';

ALTER TABLE inventory_count_lines ADD COLUMN item_name_snapshot TEXT;
ALTER TABLE inventory_count_lines ADD COLUMN internal_code_snapshot TEXT;
ALTER TABLE inventory_count_lines ADD COLUMN sku_snapshot TEXT;
ALTER TABLE inventory_count_lines ADD COLUMN reference_number_snapshot TEXT;
ALTER TABLE inventory_count_lines ADD COLUMN photo_url_snapshot TEXT;
ALTER TABLE inventory_count_lines ADD COLUMN unit_of_measurement_snapshot TEXT;
ALTER TABLE inventory_count_lines ADD COLUMN final_quantity INTEGER;
ALTER TABLE inventory_count_lines ADD COLUMN updated_by_account_id INTEGER REFERENCES user_accounts(id);
ALTER TABLE inventory_count_lines ADD COLUMN updated_by_role TEXT;

UPDATE inventory_count_lines
SET item_name_snapshot = (SELECT name FROM items WHERE items.id = inventory_count_lines.item_id),
    internal_code_snapshot = (SELECT internal_code FROM items WHERE items.id = inventory_count_lines.item_id),
    sku_snapshot = (SELECT sku FROM items WHERE items.id = inventory_count_lines.item_id),
    reference_number_snapshot = (SELECT reference_number FROM items WHERE items.id = inventory_count_lines.item_id),
    photo_url_snapshot = (SELECT photo_url FROM items WHERE items.id = inventory_count_lines.item_id),
    unit_of_measurement_snapshot = (SELECT unit_of_measurement FROM items WHERE items.id = inventory_count_lines.item_id),
    final_quantity = CASE WHEN applied = 1 THEN counted_quantity ELSE NULL END
WHERE item_name_snapshot IS NULL;

CREATE TABLE item_history_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id           INTEGER NOT NULL REFERENCES items(id),
  event_type        TEXT    NOT NULL,
  field_name        TEXT,
  old_value         TEXT,
  new_value         TEXT,
  actor_account_id  INTEGER REFERENCES user_accounts(id),
  actor_role        TEXT,
  created_at        INTEGER NOT NULL
);

CREATE INDEX ix_item_history_events_item_created
  ON item_history_events (item_id, created_at);
CREATE INDEX ix_item_history_events_type_created
  ON item_history_events (event_type, created_at);
