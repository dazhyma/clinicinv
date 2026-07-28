-- SKU теперь может быть текущим значением штрихкода предмета. При последующей
-- смене SKU прежний код остаётся алиасом того же предмета, чтобы уже
-- распечатанные этикетки продолжали сканироваться.
DROP INDEX ux_barcode_registry_owner;
CREATE INDEX ix_barcode_registry_owner ON barcode_registry (owner_type, owner_id);

-- Существующие предметы переводятся на SKU только когда нормализованное
-- значение однозначно и ещё не занято другим предметом или паком. Конфликтные
-- старые данные остаются на ITM-коде до исправления SKU через Edit.
INSERT INTO barcode_registry (barcode_value, owner_type, owner_id, created_at)
SELECT upper(trim(i.sku)), 'item', i.id, i.created_at
FROM items i
WHERE i.sku IS NOT NULL
  AND length(trim(i.sku)) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM barcode_registry r
    WHERE r.barcode_value = upper(trim(i.sku))
  )
  AND 1 = (
    SELECT count(*)
    FROM items other
    WHERE other.sku IS NOT NULL
      AND upper(trim(other.sku)) = upper(trim(i.sku))
  );

UPDATE items
SET barcode_value = upper(trim(sku))
WHERE sku IS NOT NULL
  AND length(trim(sku)) > 0
  AND EXISTS (
    SELECT 1
    FROM barcode_registry r
    WHERE r.barcode_value = upper(trim(items.sku))
      AND r.owner_type = 'item'
      AND r.owner_id = items.id
  );
