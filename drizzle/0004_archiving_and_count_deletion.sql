-- Удаление исторических сущностей выполняется мягко: журнал движений и снимки
-- остаются неизменяемыми. Неиспользованные Item/Pack удаляются физически
-- доменным слоем вместе с их техническими зависимостями.

ALTER TABLE items ADD COLUMN archived_at INTEGER;
ALTER TABLE items ADD COLUMN archived_by_account_id INTEGER REFERENCES user_accounts(id);
CREATE INDEX ix_items_archived_at ON items (archived_at);

ALTER TABLE packs ADD COLUMN archived_at INTEGER;
ALTER TABLE packs ADD COLUMN archived_by_account_id INTEGER REFERENCES user_accounts(id);
CREATE INDEX ix_packs_archived_at ON packs (archived_at);

ALTER TABLE inventory_counts ADD COLUMN deleted_at INTEGER;
ALTER TABLE inventory_counts ADD COLUMN deleted_by_account_id INTEGER REFERENCES user_accounts(id);
CREATE INDEX ix_inventory_counts_deleted_at ON inventory_counts (deleted_at);
