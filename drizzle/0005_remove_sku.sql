-- Новое дополнение к ТЗ: единственное значение штрихкода Item — постоянный
-- системный internal_code. Старые SKU и их алиасы удаляются без переноса.
UPDATE items
SET barcode_value = internal_code;

-- Канонический ITM-код должен присутствовать в глобальном реестре даже для
-- старых баз, которые ранее переключали текущий barcode_value на SKU.
INSERT OR IGNORE INTO barcode_registry (barcode_value, owner_type, owner_id, created_at)
SELECT internal_code, 'item', id, created_at
FROM items;

DELETE FROM barcode_registry
WHERE owner_type = 'item'
  AND NOT EXISTS (
    SELECT 1
    FROM items
    WHERE items.id = barcode_registry.owner_id
      AND items.internal_code = barcode_registry.barcode_value
  );

-- История карточки хранит изменения в универсальных строках, поэтому старые
-- значения удаляются отдельно от DROP COLUMN снимков.
DELETE FROM item_history_events
WHERE field_name = 'sku';

DROP INDEX ix_items_sku;
ALTER TABLE items DROP COLUMN sku;
ALTER TABLE operation_items DROP COLUMN sku_snapshot;
ALTER TABLE inventory_count_lines DROP COLUMN sku_snapshot;

-- Защита в глубину: даже прямой SQL не может снова развести системный код и
-- физически кодируемое значение.
CREATE TRIGGER trg_items_canonical_barcode_insert
BEFORE INSERT ON items
WHEN NEW.barcode_value <> NEW.internal_code
BEGIN
  SELECT RAISE(ABORT, 'item barcode_value must equal internal_code');
END;

CREATE TRIGGER trg_items_canonical_barcode_update
BEFORE UPDATE OF internal_code, barcode_value ON items
WHEN NEW.barcode_value <> NEW.internal_code
BEGIN
  SELECT RAISE(ABORT, 'item barcode_value must equal internal_code');
END;

CREATE TRIGGER trg_packs_canonical_barcode_insert
BEFORE INSERT ON packs
WHEN NEW.barcode_value <> NEW.internal_code
BEGIN
  SELECT RAISE(ABORT, 'pack barcode_value must equal internal_code');
END;

CREATE TRIGGER trg_packs_canonical_barcode_update
BEFORE UPDATE OF internal_code, barcode_value ON packs
WHEN NEW.barcode_value <> NEW.internal_code
BEGIN
  SELECT RAISE(ABORT, 'pack barcode_value must equal internal_code');
END;
